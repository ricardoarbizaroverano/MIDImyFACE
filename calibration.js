/* ============================================================
   calibration.js — MIDImyFACE Calibration UX
   ============================================================
   ARCHITECTURE RULE:
   - Manual Calibration is the single source of truth.
   - Auto Cal only computes suggestions and shows a review screen.
   - On Apply, suggested values are written into the existing
     Manual Calibration DOM inputs and change events are fired,
     so script.js picks them up through its own listeners.
   - Nothing here modifies script.js internals directly.
   ============================================================ */

(function () {
    'use strict';

    /* ── Constants ─────────────────────────────────────────── */

    const GESTURES = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];

    const GESTURE_LABELS = {
        mouthOpen: 'Mouth',
        smile:     'Smile',
        leftWink:  'Left Wink',
        rightWink: 'Right Wink',
        noseX:     'Nose X',
        noseY:     'Nose Y',
    };

    // Wizard step index → gesture key (null = neutral baseline)
    const WIZARD_STEPS = [
        null,          // 0 — neutral
        'mouthOpen',   // 1
        'smile',       // 2
        'leftWink',    // 3
        'rightWink',   // 4
        'noseX',       // 5
        'noseY',       // 6
        '__review__',  // 7
    ];

    const STEP_TIMEOUT_MS      = 9000;   // per step
    const NEUTRAL_STABLE_MS    = 1800;   // must stay stable for this long
    const ADVANCE_HOLD_MS      = 700;    // hold "enough range" before advancing
    const SAMPLE_INTERVAL_MS   = 60;     // collection tick
    const LIVE_MIRROR_MS       = 80;     // compact-row update interval
    const STEP_PREP_MS         = 1200;   // read/prepare time before evaluation
    const STEP_MIN_DURATION_MS = 5000;   // minimum time to stay on each gesture step

    // Thresholds for "enough movement detected" relative to noise floor
    // Multiplied by noise floor MAD to compute minimum acceptable range
    const RANGE_SNR = {
        mouthOpen: 4,
        smile:     4,
        leftWink:  3,
        rightWink: 3,
        noseX:     5,
        noseY:     5,
    };

    // Absolute minimum ranges to avoid progressing on tiny/noisy motion.
    const ABS_MIN_RANGE = {
        mouthOpen: 12,
        smile:     10,
        leftWink:  8,
        rightWink: 8,
        noseX:     14,
        noseY:     14,
    };

    /* ── Utility: statistics ───────────────────────────────── */

    function percentile(arr, p) {
        if (!arr.length) return 0;
        const sorted = arr.slice().sort((a, b) => a - b);
        const idx = (p / 100) * (sorted.length - 1);
        const lo  = Math.floor(idx);
        const hi  = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    }

    function median(arr) { return percentile(arr, 50); }

    function mad(arr) {
        if (!arr.length) return 0;
        const med = median(arr);
        const devs = arr.map(v => Math.abs(v - med));
        return median(devs);
    }

    /* ── Read live gesture value from DOM (safe) ───────────── */

    function getLiveValue(gesture) {
        // Try the main-page live element first (always visible), then the modal element
        const liveEl = document.getElementById(gesture + '-live');
        const modEl  = document.getElementById(gesture + 'Value');
        const el = (liveEl && liveEl.textContent.trim() !== '') ? liveEl : (modEl || liveEl);
        if (!el) return null;
        const v = parseFloat(el.textContent);
        return isNaN(v) ? null : v;
    }

    /* ── Read current manual cal inputs ────────────────────── */

    function getManualValue(gesture, field) {
        const el = document.getElementById(gesture + field);
        if (!el) return null;
        const v = parseFloat(el.value);
        return isNaN(v) ? null : v;
    }

    /* ── Write to manual calibration input + fire change ──── */

    function writeManualInput(gesture, field, value) {
        const el = document.getElementById(gesture + field);
        if (!el) return;
        const rounded = Math.round(value * 100) / 100;
        el.value = rounded;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
    }

    function parseAbsoluteNote(note) {
        if (!note || typeof note !== 'string') return null;
        const t = note.trim().toUpperCase().replace(/\s+/g, '');
        const m = t.match(/^([A-G])([#B]?)(-?\d)$/);
        if (!m) return null;
        const name = m[1] + (m[2] || '');
        const octave = parseInt(m[3], 10);
        const semitone = NOTE_INDEX[name];
        if (semitone === undefined || !Number.isFinite(octave)) return null;
        const midi = (octave + 1) * 12 + semitone;
        if (midi < 0 || midi > 127) return null;
        return { midi, canonical: name + octave };
    }

    function loadGestureNoteRanges() {
        try {
            const raw = localStorage.getItem('mmfGestureNoteRanges');
            return raw ? JSON.parse(raw) : {};
        } catch (_) {
            return {};
        }
    }

    function saveGestureNoteRanges(ranges) {
        try { localStorage.setItem('mmfGestureNoteRanges', JSON.stringify(ranges || {})); } catch (_) {}
    }

    function noteRangeControlIds(stepIdx) {
        return {
            full: `wiz-fullrange-${stepIdx}`,
            lowClass: `wiz-lowclass-${stepIdx}`,
            lowOct: `wiz-lowoct-${stepIdx}`,
            highClass: `wiz-highclass-${stepIdx}`,
            highOct: `wiz-highoct-${stepIdx}`,
            customWrap: `wiz-customrange-${stepIdx}`,
        };
    }

    function updateRangeControlsVisibility(stepIdx) {
        const ids = noteRangeControlIds(stepIdx);
        const fullEl = document.getElementById(ids.full);
        const wrapEl = document.getElementById(ids.customWrap);
        if (!fullEl || !wrapEl) return;
        wrapEl.style.display = fullEl.checked ? 'none' : 'grid';
    }

    function initRangeControlsForStep(stepIdx, gesture) {
        const ids = noteRangeControlIds(stepIdx);
        const fullEl = document.getElementById(ids.full);
        const lowClassEl = document.getElementById(ids.lowClass);
        const lowOctEl = document.getElementById(ids.lowOct);
        const highClassEl = document.getElementById(ids.highClass);
        const highOctEl = document.getElementById(ids.highOct);

        if (!fullEl || !lowClassEl || !lowOctEl || !highClassEl || !highOctEl) return;

        const current = wizardNoteRanges[gesture] || null;
        if (!current || current.fullRange) {
            fullEl.checked = true;
            lowClassEl.value = 'C';
            lowOctEl.value = '3';
            highClassEl.value = 'C';
            highOctEl.value = '5';
        } else {
            fullEl.checked = false;
            const lowParsed = parseAbsoluteNote(current.low || 'C3');
            const highParsed = parseAbsoluteNote(current.high || 'C5');
            const fallbackLow = lowParsed ? lowParsed.canonical : 'C3';
            const fallbackHigh = highParsed ? highParsed.canonical : 'C5';
            lowClassEl.value = fallbackLow.replace(/-?\d$/, '');
            lowOctEl.value = fallbackLow.match(/-?\d$/)?.[0] || '3';
            highClassEl.value = fallbackHigh.replace(/-?\d$/, '');
            highOctEl.value = fallbackHigh.match(/-?\d$/)?.[0] || '5';
        }

        fullEl.onchange = () => updateRangeControlsVisibility(stepIdx);
        updateRangeControlsVisibility(stepIdx);
    }

    function captureGestureNoteRangeFromStep(stepIdx, gesture) {
        const ids = noteRangeControlIds(stepIdx);
        const fullEl = document.getElementById(ids.full);
        const lowClassEl = document.getElementById(ids.lowClass);
        const lowOctEl = document.getElementById(ids.lowOct);
        const highClassEl = document.getElementById(ids.highClass);
        const highOctEl = document.getElementById(ids.highOct);

        if (!fullEl || !lowClassEl || !lowOctEl || !highClassEl || !highOctEl) {
            wizardNoteRanges[gesture] = { fullRange: true };
            return;
        }

        if (fullEl.checked) {
            wizardNoteRanges[gesture] = { fullRange: true };
            return;
        }

        const lowRaw = `${lowClassEl.value}${lowOctEl.value}`;
        const highRaw = `${highClassEl.value}${highOctEl.value}`;
        const low = parseAbsoluteNote(lowRaw);
        const high = parseAbsoluteNote(highRaw);
        if (!low || !high) {
            wizardNoteRanges[gesture] = { fullRange: true };
            return;
        }

        if (low.midi <= high.midi) {
            wizardNoteRanges[gesture] = { fullRange: false, low: low.canonical, high: high.canonical, lowMidi: low.midi, highMidi: high.midi };
        } else {
            wizardNoteRanges[gesture] = { fullRange: false, low: high.canonical, high: low.canonical, lowMidi: high.midi, highMidi: low.midi };
        }
    }

    /* ── Shared range selection step (interstitial after each gesture) ──── */

    function showRangeStep(gesture) {
        document.querySelectorAll('#autoCalModal .wizard-step').forEach(el => el.classList.remove('active'));
        const rangeStep = document.getElementById('wiz-step-range');
        if (!rangeStep) { advanceWizardToNextGesture(); return; }
        rangeStep.classList.add('active');

        const prog = document.getElementById('wiz-range-progress');
        if (prog) prog.textContent = `Musical Range — ${GESTURE_LABELS[gesture] || gesture}`;

        const fullBtn    = document.getElementById('wiz-range-full-btn');
        const customBtn  = document.getElementById('wiz-range-custom-btn');
        const customWrap = document.getElementById('wiz-range-custom-wrap');
        const lowClassEl = document.getElementById('wiz-range-lowclass');
        const lowOctEl   = document.getElementById('wiz-range-lowoct');
        const highClassEl= document.getElementById('wiz-range-highclass');
        const highOctEl  = document.getElementById('wiz-range-highoct');

        const current = wizardNoteRanges[gesture] || null;

        function setMode(isFull) {
            if (fullBtn)    fullBtn.classList.toggle('active', isFull);
            if (customBtn)  customBtn.classList.toggle('active', !isFull);
            if (customWrap) customWrap.style.display = isFull ? 'none' : 'block';
        }

        const startFull = !current || current.fullRange !== false;
        setMode(startFull);

        if (!current || current.fullRange !== false) {
            if (lowClassEl)  lowClassEl.value  = 'C';
            if (lowOctEl)    lowOctEl.value    = '3';
            if (highClassEl) highClassEl.value = 'C';
            if (highOctEl)   highOctEl.value   = '5';
        } else {
            if (lowClassEl)  lowClassEl.value  = (current.low  || 'C3').replace(/[-\d]+$/, '');
            if (lowOctEl)    lowOctEl.value    = ((current.low  || 'C3').match(/[-\d]+$/) || ['3'])[0];
            if (highClassEl) highClassEl.value = (current.high || 'C5').replace(/[-\d]+$/, '');
            if (highOctEl)   highOctEl.value   = ((current.high || 'C5').match(/[-\d]+$/) || ['5'])[0];
        }

        if (fullBtn)   fullBtn.onclick   = () => setMode(true);
        if (customBtn) customBtn.onclick = () => setMode(false);

        const nextBtn = document.getElementById('wiz-range-next');
        if (nextBtn) {
            nextBtn.onclick = () => {
                captureRangeFromSharedPanel(gesture);
                advanceWizardToNextGesture();
            };
        }
        const cancelBtn = document.getElementById('wiz-range-cancel');
        if (cancelBtn) cancelBtn.onclick = () => closeAutoCalModal();
    }

    function captureRangeFromSharedPanel(gesture) {
        const fullBtn = document.getElementById('wiz-range-full-btn');
        const isFull  = !fullBtn || fullBtn.classList.contains('active');
        if (isFull) { wizardNoteRanges[gesture] = { fullRange: true }; return; }

        const lowClassEl = document.getElementById('wiz-range-lowclass');
        const lowOctEl   = document.getElementById('wiz-range-lowoct');
        const highClassEl= document.getElementById('wiz-range-highclass');
        const highOctEl  = document.getElementById('wiz-range-highoct');

        const lowRaw  = `${lowClassEl  ? lowClassEl.value  : 'C'}${lowOctEl  ? lowOctEl.value  : '3'}`;
        const highRaw = `${highClassEl ? highClassEl.value : 'C'}${highOctEl ? highOctEl.value : '5'}`;
        const low  = parseAbsoluteNote(lowRaw);
        const high = parseAbsoluteNote(highRaw);
        if (!low || !high) { wizardNoteRanges[gesture] = { fullRange: true }; return; }

        if (low.midi <= high.midi) {
            wizardNoteRanges[gesture] = { fullRange: false, low: low.canonical, high: high.canonical, lowMidi: low.midi, highMidi: high.midi };
        } else {
            wizardNoteRanges[gesture] = { fullRange: false, low: high.canonical, high: low.canonical, lowMidi: high.midi, highMidi: low.midi };
        }
    }

    function activateScalingForGesture(gesture) {
        const btn = document.getElementById(gesture + 'Scaling');
        if (!btn) return;
        if (!btn.classList.contains('active')) btn.click();
    }

    /* ── Apply suggested results to Manual Calibration ──────── */

    function applyResults(results, gestureFilter) {
        // results: { gesture: { min, max, minChange, umbral } | null }
        // gestureFilter: array of gesture keys, or null for all
        GESTURES.forEach(g => {
            if (gestureFilter && !gestureFilter.includes(g)) return;
            const r = results[g];
            if (!r) return; // skipped or failed
            if (r.min     !== null) writeManualInput(g, 'Min',       r.min);
            if (r.max     !== null) writeManualInput(g, 'Max',       r.max);
            if (r.umbral  !== null) writeManualInput(g, 'Umbral',    r.umbral);
            activateScalingForGesture(g);
        });

        const existingRanges = loadGestureNoteRanges();
        const mergedRanges = { ...existingRanges };
        GESTURES.forEach(g => {
            if (gestureFilter && !gestureFilter.includes(g)) return;
            mergedRanges[g] = wizardNoteRanges[g] || null;
        });
        saveGestureNoteRanges(mergedRanges);
    }

    /* ═══════════════════════════════════════════════════════
       MANUAL CALIBRATION PANEL
    ═══════════════════════════════════════════════════════ */

    function openManualCal(scrollToGesture) {
        const modal = document.getElementById('manualCalModal');
        if (!modal) return;
        modal.classList.add('open');
        refreshMcalNoteRanges(); // always sync UI from storage when opening
        // Scroll to specific gesture row if requested (per-gesture Calibrate btn)
        if (scrollToGesture) {
            requestAnimationFrame(() => {
                const row = modal.querySelector('.gesture-row:has(#' + scrollToGesture + 'Value)');
                if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        }
    }

    function closeManualCal() {
        const modal = document.getElementById('manualCalModal');
        if (modal) modal.classList.remove('open');
    }

    /* ═══════════════════════════════════════════════════════
       LIVE VALUE MIRROR — compact rows on main page
    ═══════════════════════════════════════════════════════ */

    // True once FaceMesh has written at least one real (non-zero) value
    let faceMeshActive = false;

    function startLiveMirror() {
        console.log('[MIDImyFACE Calibration] startLiveMirror() starting');
        let logCounter = 0;
        setInterval(() => {
            GESTURES.forEach(g => {
                const src = document.getElementById(g + 'Value');
                const dst = document.getElementById(g + '-live');
                if (src && dst) {
                    const srcVal = src.textContent;
                    dst.textContent = srcVal;
                    // Log first 3 mirrors and any non-zero values
                    if (logCounter < 3 || parseFloat(srcVal) !== 0) {
                        if (logCounter === 0) console.log('[MIDImyFACE] startLiveMirror mirror tick - src=' + srcVal);
                    }
                    // Mark face mesh as active when any gesture has a non-zero value
                    if (!faceMeshActive && parseFloat(srcVal) !== 0) {
                        faceMeshActive = true;
                        console.log('[MIDImyFACE] *** FaceMesh ACTIVATED! Detected non-zero value: ' + g + '=' + srcVal);
                    }
                }
            });
            logCounter++;
        }, LIVE_MIRROR_MS);
    }

    /* ═══════════════════════════════════════════════════════
       AUTOMATIC CALIBRATION WIZARD
    ═══════════════════════════════════════════════════════ */

    let wizardActive    = false;
    let wizardStep      = 0;
    let wizardCollector = null;     // { samples[], timer, timeout }
    let wizardResults   = {};       // keyed by gesture
    let wizardBaseline  = {};       // neutral frame medians
    let wizardGestureFilter = null; // null = all, or ['mouthOpen'] etc.
    let wizardBypassState = null;   // UI/mode snapshot restored when wizard closes
    let wizardNoteRanges = {};      // optional per-gesture note ranges

    const NOTE_INDEX = { C:0, 'C#':1, DB:1, D:2, 'D#':3, EB:3, E:4, F:5, 'F#':6, GB:6, G:7, 'G#':8, AB:8, A:9, 'A#':10, BB:10, B:11 };

    /* ── helpers ── */

    function wizEl(id) { return document.getElementById(id); }

    function isActiveBtn(id) {
        const el = document.getElementById(id);
        return !!(el && el.classList.contains('active'));
    }

    function setBtnActiveByClick(id, shouldBeActive) {
        const el = document.getElementById(id);
        if (!el) return;
        const isActive = el.classList.contains('active');
        if (isActive !== shouldBeActive) el.click();
    }

    function snapshotAndApplyWizardBypass() {
        if (wizardBypassState) return;

        const mute = {};
        const solo = {};
        GESTURES.forEach(g => {
            mute[g] = isActiveBtn(g + 'Mute');
            solo[g] = isActiveBtn(g + 'Solo');
        });

        wizardBypassState = {
            mute,
            solo,
            thereminActive: isActiveBtn('thereminToggle'),
            percussionActive: isActiveBtn('percussionToggle'),
        };

        // Silence app modes during wizard (raw tracking only)
        setBtnActiveByClick('thereminToggle', false);
        setBtnActiveByClick('percussionToggle', false);

        // Ensure all gesture inputs are available for detection
        GESTURES.forEach(g => {
            setBtnActiveByClick(g + 'Solo', false);
            setBtnActiveByClick(g + 'Mute', false);
        });
    }

    function restoreWizardBypassState() {
        if (!wizardBypassState) return;

        GESTURES.forEach(g => {
            setBtnActiveByClick(g + 'Mute', !!wizardBypassState.mute[g]);
            setBtnActiveByClick(g + 'Solo', !!wizardBypassState.solo[g]);
        });

        setBtnActiveByClick('thereminToggle', !!wizardBypassState.thereminActive);
        setBtnActiveByClick('percussionToggle', !!wizardBypassState.percussionActive);

        // Re-fire the active theremin sub-mode radio (notas/synth) so script.js
        // re-runs its mode setup: restores mouthOpenNotas active state, re-wires
        // the Tone audio chain, and re-applies mute preferences for that mode.
        if (wizardBypassState.thereminActive) {
            setTimeout(() => {
                const notesRadio = document.getElementById('thereminNotesOption');
                const synthRadio = document.getElementById('thereminSynthOption');
                if (notesRadio && notesRadio.checked) {
                    notesRadio.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (synthRadio && synthRadio.checked) {
                    synthRadio.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, 60);
        }

        wizardBypassState = null;
    }

    function showWizardStep(idx) {
        document.querySelectorAll('#autoCalModal .wizard-step').forEach(el => el.classList.remove('active'));
        const step = document.getElementById('wiz-step-' + idx);
        if (step) step.classList.add('active');
        wizardStep = idx;
    }

    function setWizStatus(stepIdx, msg) {
        const el = wizEl('wiz-status-' + stepIdx);
        if (el) el.textContent = msg;
    }

    function setWizBar(stepIdx, pct) {
        const el = wizEl('wiz-bar-' + stepIdx);
        if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    function stopCurrentCollector() {
        if (wizardCollector) {
            clearInterval(wizardCollector.sampleTimer);
            clearTimeout(wizardCollector.timeoutTimer);
            if (wizardCollector.timeoutRaf) cancelAnimationFrame(wizardCollector.timeoutRaf);
            wizardCollector = null;
        }
    }

    function openAutoCalModal() {
        const modal = document.getElementById('autoCalModal');
        if (modal) modal.classList.add('open');
    }

    function closeAutoCalModal(skipRestore) {
        const modal = document.getElementById('autoCalModal');
        if (modal) modal.classList.remove('open');
        stopCurrentCollector();
        wizardActive = false;
        if (!skipRestore) restoreWizardBypassState();
    }

    /* ── Neutral baseline capture (Step 0) ───────────────── */

    function runNeutralStep() {
        console.log('[MIDImyFACE Wizard] Starting neutral step (step 0)');
        showWizardStep(0);
        setWizBar(0, 0);
        setWizStatus(0, 'Waiting for stable face...');
        wizardBaseline = {};

        const samples = {}; // gesture → []
        GESTURES.forEach(g => { samples[g] = []; });

        let stableStart = null;
        const STABLE_THRESH = 5; // relaxed: units vary per gesture
        let sampleTimer, timeoutTimer;

        stopCurrentCollector();

        sampleTimer = setInterval(() => {
            // Check face is detected: at least one gesture must have a non-null value
            let anyPresent = false;
            GESTURES.forEach(g => {
                const v = getLiveValue(g);
                if (v !== null) { anyPresent = true; samples[g].push(v); }
            });

            if (!anyPresent) {
                stableStart = null;
                setWizStatus(0, 'No face detected - look at the camera...');
                return;
            }

            // If FaceMesh hasn't actually started yet (all values are still 0), wait
            if (!faceMeshActive) {
                stableStart = null;
                setWizStatus(0, 'Initializing camera and face detection...');
                return;
            }

            // Keep only last 40 samples per gesture for stability check
            GESTURES.forEach(g => {
                if (samples[g].length > 40) samples[g] = samples[g].slice(-40);
            });

            // Need at least 10 samples per present gesture before evaluating
            const presentGestures = GESTURES.filter(g => samples[g].length >= 10);
            if (presentGestures.length === 0) {
                setWizStatus(0, 'Collecting baseline...');
                return;
            }

            // Check stability: MAD of recent samples should be small
            const unstable = presentGestures.some(g => {
                return mad(samples[g].slice(-20)) > STABLE_THRESH;
            });

            if (unstable) {
                stableStart = null;
                setWizStatus(0, 'Hold still...');
                setWizBar(0, 0);
                return;
            }

            if (!stableStart) stableStart = Date.now();
            const elapsed = Date.now() - stableStart;
            const pct = Math.min(100, (elapsed / NEUTRAL_STABLE_MS) * 100);
            setWizBar(0, pct);
            setWizStatus(0, 'Good - hold still...');

            if (elapsed >= NEUTRAL_STABLE_MS) {
                clearInterval(sampleTimer);
                clearTimeout(timeoutTimer);
                // Compute baseline medians from all collected samples
                GESTURES.forEach(g => {
                    const s = samples[g];
                    wizardBaseline[g] = {
                        median: s.length ? median(s) : 0,
                        noise:  s.length ? (mad(s) || 0.5) : 1,
                    };
                });
                setWizStatus(0, 'Baseline captured.');
                setTimeout(() => advanceWizardToNextGesture(), 500);
            }
        }, SAMPLE_INTERVAL_MS);

        timeoutTimer = setTimeout(() => {
            clearInterval(sampleTimer);
            
            // If FaceMesh never started, auto-advance to gesture steps (they'll auto-skip too)
            console.log('[MIDImyFACE Wizard] Neutral step timeout fired. faceMeshActive=' + faceMeshActive);
            if (!faceMeshActive) {
                console.log('[MIDImyFACE Wizard] *** Neutral step: Auto-advancing (no face data detected after 9s)');
                setWizStatus(0, 'Camera not initialized. Proceeding to gesture steps...');
                setTimeout(() => {
                    console.log('[MIDImyFACE Wizard] *** Advancing from neutral to gesture steps...');
                    advanceWizardToNextGesture();
                }, 2000);  // Pause 2s so user can see the message
                return;
            }
            
            console.log('[MIDImyFACE Wizard] Neutral step timeout: faceMeshActive=true, showing Retry button');
            setWizStatus(0, 'No face detected. Check camera permissions and ensure good lighting.');
            setWizBar(0, 0);
            const btnArea = document.querySelector('#wiz-step-0 .wizard-buttons');
            if (btnArea && !btnArea.querySelector('.retry-btn')) {
                const retryBtn = document.createElement('button');
                retryBtn.className = 'wizard-btn retry-btn';
                retryBtn.textContent = 'Retry';
                retryBtn.onclick = () => { retryBtn.remove(); runNeutralStep(); };
                btnArea.prepend(retryBtn);
            }
        }, STEP_TIMEOUT_MS);

        wizardCollector = { sampleTimer, timeoutTimer };
    }

    /* ── Gesture capture step ──────────────────────────────── */

    function runGestureStep(stepIdx, gesture) {
        showWizardStep(stepIdx);
        setWizBar(stepIdx, 0);
        setWizStatus(stepIdx, 'Capturing...');

        const samples      = [];
        const baseline     = wizardBaseline[gesture] || { median: 0, noise: 1 };
        const noiseFloor   = baseline.noise || 0.5;
        const snrRequired  = RANGE_SNR[gesture] || 4;
        const minRange     = Math.max(noiseFloor * snrRequired, ABS_MIN_RANGE[gesture] || 8);
        const isWink       = gesture === 'leftWink' || gesture === 'rightWink';
        const isBipolar    = gesture === 'noseX' || gesture === 'noseY';
        const stepStartTs  = Date.now();

        let advanceHoldStart = null;
        let sampleTimer, timeoutTimer, tbarRaf;

        stopCurrentCollector();

        sampleTimer = setInterval(() => {
            const elapsed = Date.now() - stepStartTs;

            if (elapsed < STEP_PREP_MS) {
                const left = Math.ceil((STEP_PREP_MS - elapsed) / 1000);
                setWizStatus(stepIdx, `Get ready... starting in ${left}s`);
                setWizBar(stepIdx, 0);
                return;
            }

            // Accept 0 as valid (noseX/Y can legitimately be 0 or near-0)
            const liveEl = document.getElementById(gesture + '-live');
            const modEl  = document.getElementById(gesture + 'Value');
            const el = liveEl || modEl;
            if (!el) return;
            const raw = el.textContent;
            const v = parseFloat(raw);
            if (isNaN(v)) return;
            samples.push(v);

            if (samples.length > 200) samples.splice(0, samples.length - 200);

            let p5    = percentile(samples, 5);
            let p95   = percentile(samples, 95);
            let range = p95 - p5;

            const pct = Math.min(100, (range / (minRange * 1.5)) * 100);
            setWizBar(stepIdx, pct);

            if (range > minRange) {
                if (!advanceHoldStart) advanceHoldStart = Date.now();
                const held = Date.now() - advanceHoldStart;
                const holdPct = Math.min(100, (held / ADVANCE_HOLD_MS) * 100);
                const remainingMinMs = Math.max(0, STEP_MIN_DURATION_MS - elapsed);

                if (isWink) {
                    setWizStatus(stepIdx, `Activation detected - hold ${Math.round(holdPct)}%` + (remainingMinMs > 0 ? ` | keep moving ${Math.ceil(remainingMinMs / 1000)}s` : ''));
                } else {
                    setWizStatus(stepIdx, `Good range (${range.toFixed(1)}) - keep going` + (remainingMinMs > 0 ? ` ${Math.ceil(remainingMinMs / 1000)}s` : ''));
                }

                if (held >= ADVANCE_HOLD_MS && elapsed >= STEP_MIN_DURATION_MS) {
                    clearInterval(sampleTimer);
                    clearTimeout(timeoutTimer);
                    cancelAnimationFrame(tbarRaf);
                    storeGestureResult(gesture, samples, baseline, isBipolar, isWink);
                    setWizStatus(stepIdx, `Captured. Choose your note range...`);
                    setTimeout(() => showRangeStep(gesture), 400);
                }
            } else {
                advanceHoldStart = null;
                if (samples.length > 15) {
                    setWizStatus(stepIdx, `Need more movement (range: ${range.toFixed(1)}, need: ${minRange.toFixed(1)})`);
                }
            }
        }, SAMPLE_INTERVAL_MS);

        // Animate timeout bar
        const timeoutStart = Date.now();
        tbarRaf = null;
        function animateTimeoutBar() {
            const remaining = 1 - (Date.now() - timeoutStart) / STEP_TIMEOUT_MS;
            const tbar = wizEl('wiz-tbar-' + stepIdx);
            if (tbar) tbar.style.width = Math.max(0, remaining * 100) + '%';
            if (remaining > 0) tbarRaf = requestAnimationFrame(animateTimeoutBar);
        }
        tbarRaf = requestAnimationFrame(animateTimeoutBar);

        timeoutTimer = setTimeout(() => {
            clearInterval(sampleTimer);
            cancelAnimationFrame(tbarRaf);
            
            // If FaceMesh never started, auto-skip this gesture
            if (!faceMeshActive) {
                console.log('[MIDImyFACE Wizard] Step ' + stepIdx + ' (' + gesture + '): Auto-skipping (no face data after 9s)');
                wizardResults[gesture] = null;
                setWizStatus(stepIdx, 'Skipped (camera not initialized)');
                setTimeout(() => {
                    console.log('[MIDImyFACE Wizard] Advancing from step ' + stepIdx + ' to next...');
                    advanceWizardToNextGesture();
                }, 1500);  // Pause 1.5s so user can see each skip
                return;
            }
            
            setWizStatus(stepIdx, 'Not enough movement detected.');
            setWizBar(stepIdx, 0);

            const btnArea = document.querySelector('#wiz-step-' + stepIdx + ' .wizard-buttons');
            if (btnArea && !btnArea.querySelector('.retry-btn')) {
                const retryBtn = document.createElement('button');
                retryBtn.className = 'wizard-btn retry-btn';
                retryBtn.textContent = 'Retry';
                retryBtn.onclick = () => {
                    retryBtn.remove();
                    const tbar = wizEl('wiz-tbar-' + stepIdx);
                    if (tbar) tbar.style.width = '100%';
                    runGestureStep(stepIdx, gesture);
                };
                btnArea.prepend(retryBtn);
            }
        }, STEP_TIMEOUT_MS);

        wizardCollector = { sampleTimer, timeoutTimer, timeoutRaf: tbarRaf };

        // Skip button
        const skipBtn = wizEl('wiz-skip-' + stepIdx);
        if (skipBtn) {
            skipBtn.onclick = () => {
                clearInterval(sampleTimer);
                clearTimeout(timeoutTimer);
                cancelAnimationFrame(tbarRaf);
                wizardResults[gesture] = null;
                advanceWizardToNextGesture();
            };
        }
    }

    /* ── Compute and store gesture result ──────────────────── */

    function storeGestureResult(gesture, samples, baseline, isBipolar, isWink) {
        if (!samples.length) { wizardResults[gesture] = null; return; }

        let p5  = percentile(samples, 5);
        let p95 = percentile(samples, 95);
        let noise = baseline.noise || 0.5;

        let min, max, minChange, umbral;

        // Raw-domain calibration for all gestures.
        min       = Math.round(p5);
        max       = Math.round(p95);
        minChange = null;

        // Keep trigger threshold neutral for auto-calibration.
        umbral    = 0;

        wizardResults[gesture] = { min, max, minChange, umbral };
    }

    /* ── Wizard step sequencer ─────────────────────────────── */

    function advanceWizardToNextGesture() {
        console.log('[MIDImyFACE Wizard] advanceWizardToNextGesture: wizardStep=' + wizardStep + ', WIZARD_STEPS.length=' + WIZARD_STEPS.length);
        stopCurrentCollector();
        // Find next step index
        // If gestureFilter active, skip steps not in filter
        let next = wizardStep + 1;
        console.log('[MIDImyFACE Wizard]   Loop: next=' + next + ', limit=' + (WIZARD_STEPS.length - 1) + ', gestures=' + WIZARD_STEPS.join(','));
        while (next < WIZARD_STEPS.length - 1) {
            const g = WIZARD_STEPS[next];
            if (!g || g === '__review__') break;
            if (!wizardGestureFilter || wizardGestureFilter.includes(g)) break;
            next++;
        }
        console.log('[MIDImyFACE Wizard] *** Advancing to step ' + next);
        runWizardStep(next);
    }

    function runWizardStep(idx) {
        console.log('[MIDImyFACE Wizard] >>> runWizardStep: idx=' + idx + ', WIZARD_STEPS.length=' + WIZARD_STEPS.length);
        wizardStep = idx;  // UPDATE: Always track current step
        if (idx >= WIZARD_STEPS.length) {
            console.log('[MIDImyFACE Wizard] *** JUMP TO REVIEW: idx >= length (' + idx + ' >= ' + WIZARD_STEPS.length + ')');
            showReview();
            return;
        }

        if (idx === 0) {
            runNeutralStep();
            return;
        }

        const key = WIZARD_STEPS[idx];
        console.log('[MIDImyFACE Wizard]   Step key: ' + key);
        if (!key || key === '__review__') {
            console.log('[MIDImyFACE Wizard] *** JUMP TO REVIEW: key is null/review');
            showReview();
            return;
        }

        // Cancel buttons
        [0,1,2,3,4,5,6].forEach(i => {
            const btn = wizEl('wiz-cancel-' + i);
            if (btn) btn.onclick = () => closeAutoCalModal();
        });

        runGestureStep(idx, key);
    }

    /* ── Review screen ──────────────────────────────────────── */

    function showReview() {
        stopCurrentCollector();
        showWizardStep(7);

        const body = document.getElementById('wiz-review-body');
        if (!body) return;

        const rows = GESTURES.filter(g =>
            !wizardGestureFilter || wizardGestureFilter.includes(g)
        ).map(g => {
            const r = wizardResults[g];
            const curMin   = getManualValue(g, 'Min');
            const curMax   = getManualValue(g, 'Max');
            const curUmb   = getManualValue(g, 'Umbral');
            const curMC    = getManualValue(g, 'MinChange');
            const noteCfg = wizardNoteRanges[g] || { fullRange: true };
            const noteRange = (noteCfg.fullRange || !noteCfg.low || !noteCfg.high)
                ? 'Full MIDI'
                : `${noteCfg.low} - ${noteCfg.high}`;
            const minChangeText = `${curMC ?? '—'} → <span class="suggested">unchanged</span>`;

            if (!r) {
                return `<tr class="skipped">
                    <td>${GESTURE_LABELS[g]}</td>
                    <td colspan="5" style="color:#555;font-style:italic">Skipped</td>
                </tr>`;
            }
            return `<tr>
                <td>${GESTURE_LABELS[g]}</td>
                <td>${curMin ?? '—'} → <span class="suggested">${r.min}</span></td>
                <td>${curMax ?? '—'} → <span class="suggested">${r.max}</span></td>
                <td>${minChangeText}</td>
                <td>${curUmb ?? '—'} → <span class="suggested">${r.umbral}</span></td>
                <td>${noteRange}</td>
            </tr>`;
        }).join('');

        body.innerHTML = `
            <table class="review-table">
                <thead>
                    <tr>
                        <th>Gesture</th>
                        <th>Min (cur→sug)</th>
                        <th>Max (cur→sug)</th>
                        <th>MinChange</th>
                        <th>Threshold</th>
                        <th>Note Range</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;

        // Apply button
        const applyBtn = wizEl('wiz-apply');
        if (applyBtn) {
            applyBtn.onclick = async () => {
                // Apply calibration values first
                applyResults(wizardResults, wizardGestureFilter);
                // Close modal visually but defer bypass-state restore until Tone is live
                closeAutoCalModal(true /* skipRestore */);
                // Await Tone AudioContext resume so theremin activates against a live context
                try {
                    if (window.Tone && typeof window.Tone.start === 'function') {
                        await window.Tone.start();
                    }
                } catch (_) {}
                // Now restore bypass (re-enables theremin/percussion) with live audio
                restoreWizardBypassState();
                // Sync manual cal note-range UI with newly saved ranges
                refreshMcalNoteRanges();
                // Flash manual cal button briefly
                const manBtn = document.getElementById('openManualCalBtn');
                if (manBtn) {
                    manBtn.style.background = 'lime';
                    manBtn.style.color = 'black';
                    setTimeout(() => {
                        manBtn.style.background = '';
                        manBtn.style.color = '';
                    }, 1200);
                }
            };
        }

        const retryAllBtn = wizEl('wiz-retry-all');
        if (retryAllBtn) {
            retryAllBtn.onclick = () => startWizard(wizardGestureFilter);
        }

        const cancelReview = wizEl('wiz-cancel-review');
        if (cancelReview) {
            cancelReview.onclick = () => closeAutoCalModal();
        }
    }

    /* ── Start wizard ───────────────────────────────────────── */

    function startWizard(gestureFilter) {
        console.log('[MIDImyFACE Wizard] Starting wizard. faceMeshActive=' + faceMeshActive + ', gestureFilter=' + (gestureFilter ? gestureFilter.join(',') : 'null'));
        // gestureFilter: null (all gestures) or array like ['mouthOpen']
        wizardResults      = {};
        wizardBaseline     = {};
        wizardNoteRanges   = loadGestureNoteRanges();
        wizardGestureFilter = gestureFilter || null;
        wizardActive       = true;
        wizardStep         = 0;  // *** RESET: Always start at step 0 ***

        // Wizard-only bypass: unmute inputs, disable solos and silence sound modes.
        snapshotAndApplyWizardBypass();

        // Clean up from previous run: remove retry buttons, reset status displays
        document.querySelectorAll('#autoCalModal .retry-btn').forEach(el => el.remove());
        
        // Reset all status displays to defaults
        [0,1,2,3,4,5,6].forEach(i => {
            const status = wizEl('wiz-status-' + i);
            if (status) {
                if (i === 0) status.textContent = 'Waiting for stable face...';
                else status.textContent = 'Capturing...';
            }
            const bar = wizEl('wiz-bar-' + i);
            if (bar) bar.style.width = '0%';
            const tbar = wizEl('wiz-tbar-' + i);
            if (tbar) tbar.style.width = '100%';
        });

        openAutoCalModal();

        // Cancel buttons
        [0,1,2,3,4,5,6].forEach(i => {
            const btn = wizEl('wiz-cancel-' + i);
            if (btn) btn.onclick = () => closeAutoCalModal();
        });

        // Update step labels for single-gesture mode
        if (gestureFilter && gestureFilter.length === 1) {
            const g = gestureFilter[0];
            const stepIdx = WIZARD_STEPS.indexOf(g);
            if (stepIdx > 0) {
                const prog = wizEl('wiz-prog-' + stepIdx);
                if (prog) prog.textContent = `Step 2 / 2 — ${GESTURE_LABELS[g]}`;
            }
        }

        runWizardStep(0); // always start with neutral
    }

    /* ── Manual Calibration Note Ranges ─────────────────── */

    // updateMcalVis and saveMcalRange are shared between init and refresh — hoist them
    function _updateMcalVis(gesture) {
        const fullEl = document.getElementById(`mcal-fullrange-${gesture}`);
        const wrapEl = document.getElementById(`mcal-customrange-${gesture}`);
        if (!fullEl || !wrapEl) return;
        wrapEl.style.display = fullEl.checked ? 'none' : 'flex';
    }

    function _saveMcalRange(gesture) {
        const fullEl = document.getElementById(`mcal-fullrange-${gesture}`);
        if (!fullEl) return;
        const ranges = loadGestureNoteRanges();
        if (fullEl.checked) {
            ranges[gesture] = { fullRange: true };
        } else {
            const lowCls  = document.getElementById(`mcal-lowclass-${gesture}`);
            const lowOct  = document.getElementById(`mcal-lowoct-${gesture}`);
            const highCls = document.getElementById(`mcal-highclass-${gesture}`);
            const highOct = document.getElementById(`mcal-highoct-${gesture}`);
            const lowRaw  = `${lowCls ? lowCls.value : 'C'}${lowOct ? lowOct.value : '3'}`;
            const highRaw = `${highCls ? highCls.value : 'C'}${highOct ? highOct.value : '5'}`;
            const low  = parseAbsoluteNote(lowRaw);
            const high = parseAbsoluteNote(highRaw);
            if (low && high) {
                if (low.midi <= high.midi) {
                    ranges[gesture] = { fullRange: false, low: low.canonical, high: high.canonical, lowMidi: low.midi, highMidi: high.midi };
                } else {
                    ranges[gesture] = { fullRange: false, low: high.canonical, high: low.canonical, lowMidi: high.midi, highMidi: low.midi };
                }
            } else {
                ranges[gesture] = { fullRange: true };
            }
        }
        saveGestureNoteRanges(ranges);
    }

    /* Populate manual-cal note-range rows from current localStorage state.
       Called every time the Manual Cal modal opens and after Apply. */
    function refreshMcalNoteRanges() {
        const ranges = loadGestureNoteRanges();
        GESTURES.forEach(gesture => {
            const fullEl  = document.getElementById(`mcal-fullrange-${gesture}`);
            const lowCls  = document.getElementById(`mcal-lowclass-${gesture}`);
            const lowOct  = document.getElementById(`mcal-lowoct-${gesture}`);
            const highCls = document.getElementById(`mcal-highclass-${gesture}`);
            const highOct = document.getElementById(`mcal-highoct-${gesture}`);
            if (!fullEl) return;
            const cur = ranges[gesture] || null;
            if (cur && cur.fullRange === false) {
                fullEl.checked = false;
                const lowMatch  = (cur.low  || 'C3').match(/^([A-G]#?)([-\d]+)$/);
                const highMatch = (cur.high || 'C5').match(/^([A-G]#?)([-\d]+)$/);
                if (lowMatch  && lowCls  && lowOct)  { lowCls.value  = lowMatch[1];  lowOct.value  = lowMatch[2]; }
                if (highMatch && highCls && highOct) { highCls.value = highMatch[1]; highOct.value = highMatch[2]; }
            } else {
                fullEl.checked = true;
            }
            _updateMcalVis(gesture);
        });
    }

    /* Wire event listeners once at page init. Populate initial values via refreshMcalNoteRanges. */
    function initManualCalNoteRanges() {
        GESTURES.forEach(gesture => {
            const fullEl  = document.getElementById(`mcal-fullrange-${gesture}`);
            const lowCls  = document.getElementById(`mcal-lowclass-${gesture}`);
            const lowOct  = document.getElementById(`mcal-lowoct-${gesture}`);
            const highCls = document.getElementById(`mcal-highclass-${gesture}`);
            const highOct = document.getElementById(`mcal-highoct-${gesture}`);
            if (!fullEl) return;
            fullEl.addEventListener('change', () => { _updateMcalVis(gesture); _saveMcalRange(gesture); });
            [lowCls, lowOct, highCls, highOct].forEach(el => {
                if (el) el.addEventListener('change', () => _saveMcalRange(gesture));
            });
        });
        refreshMcalNoteRanges(); // populate on first load
    }

    /* ═══════════════════════════════════════════════════════
       WIRING — event listeners
    ═══════════════════════════════════════════════════════ */

    function init() {
        console.log('[MIDImyFACE Calibration] Initializing calibration.js');
        /* Manual Cal */
        const openManBtn  = document.getElementById('openManualCalBtn');
        const closeManBtn = document.getElementById('closeManualCalBtn');
        if (openManBtn)  openManBtn.addEventListener('click',  () => openManualCal());
        if (closeManBtn) closeManBtn.addEventListener('click', closeManualCal);

        // Close on overlay click
        const manModal = document.getElementById('manualCalModal');
        if (manModal) {
            manModal.addEventListener('click', e => {
                if (e.target === manModal) closeManualCal();
            });
        }

        initManualCalNoteRanges();

        /* Per-gesture Calibrate buttons (compact rows on main page) */
        document.querySelectorAll('.gesture-calibrate-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const gesture = btn.getAttribute('data-cal-gesture');
                if (!gesture) return;
                startWizard([gesture]);
            });
        });

        /* Auto Cal */
        const openAutoBtn = document.getElementById('openAutoCalBtn');
        if (openAutoBtn) openAutoBtn.addEventListener('click', () => startWizard(null));

        const closeAutoBtn = document.getElementById('closeAutoCalBtn');
        if (closeAutoBtn) closeAutoBtn.addEventListener('click', closeAutoCalModal);

        // Close on overlay click
        const autoModal = document.getElementById('autoCalModal');
        if (autoModal) {
            autoModal.addEventListener('click', e => {
                if (e.target === autoModal) closeAutoCalModal();
            });
        }

        // Escape key closes any open cal modal
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closeManualCal();
                closeAutoCalModal();
            }
        });

        /* Live value mirroring */
        startLiveMirror();
    }

    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
