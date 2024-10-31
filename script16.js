// Variables globales
let video;
let faceMesh;
let midiAccess;
let midiOutput;
let lastNoseY = null;
let lastNoseX = null;
let restFaceCounter = 0;
let activeGesture = null;
let gestureCoolDown = {};
let gestureStability = {};
let currentLandmarks = null; // Variable para almacenar landmarks
let isInstrumentLoaded = false;

// Estados de los gestos
let controlGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

let muteGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

let soloGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

let notasGestures = {
    mouthOpen: true,
    smile: true,
    leftWink: true,
    rightWink: true,
    noseX: true,
    noseY: true,
};

let disparadorGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

// Umbrales para Disparador (Valores por defecto, pueden ser ajustados por el usuario en el HTML)
let gestureUmbrales = {
    mouthOpen: 30,
    smile: 30,
    leftWink: 15,
    rightWink: 15,
    noseX: 50,
    noseY: 50,
};

// Variables para escalado
let scalingGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

// Rango mínimo y máximo para escalado (pueden ser ajustados por el usuario en el HTML)
let gestureRanges = {
    mouthOpen: { min: 20, max: 200 },
    smile: { min: 20, max: 200 },
    leftWink: { min: 20, max: 200 },
    rightWink: { min: 20, max: 200 },
    noseX: { min: 0, max: window.innerWidth },
    noseY: { min: 0, max: window.innerHeight },
};

// Mínimo cambio por gesto (pueden ser ajustados por el usuario en el HTML)
let gestureMinChanges = {
    mouthOpen: 10,
    smile: 10,
    leftWink: 5,
    rightWink: 5,
    noseX: 10,
    noseY: 10,
};

// Estados para Disparador
let gestureDisparadorStates = {
    mouthOpen: { armed: true, lastValue: null, lastTriggerTime: 0 },
    smile: { armed: true, lastValue: null, lastTriggerTime: 0 },
    leftWink: { armed: true, lastValue: null, lastTriggerTime: 0 },
    rightWink: { armed: true, lastValue: null, lastTriggerTime: 0 },
    noseX: { armed: true, lastValue: null, lastTriggerTime: 0 },
    noseY: { armed: true, lastValue: null, lastTriggerTime: 0 },
};

// Direcciones de Disparador ('ascending' o 'descending')
let gestureDisparadorDirections = {
    mouthOpen: 'ascending',
    smile: 'ascending',
    leftWink: 'descending',
    rightWink: 'descending',
    noseX: 'ascending',
    noseY: 'ascending',
};

// Variables para escalas musicales
let selectedScale = 'major';
let rootNote = 'C';

// Mapas de escalas musicales
const scales = {
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
    pentatonic: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
    bebop: [0, 2, 4, 5, 7, 9, 10, 11],
    harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
    melodic_minor: [0, 2, 3, 5, 7, 9, 11],
};

// Canales CC asignados a cada gesto y parámetros de envolvente
let gestureCCNumbers = {
    mouthOpen: 1,
    smile: 2,
    leftWink: 3,
    rightWink: 4,
    noseX: 5,
    noseY: 6,
    attack: 10,  // Número CC para el control de 'attack'
    decay: 11,   // Número CC para el control de 'decay'
    sustain: 12, // Número CC para el control de 'sustain'
    release: 13  // Número CC para el control de 'release'
};

let attack = 100; // Valor inicial en milisegundos
let decay = 300;  // Valor inicial en milisegundos
let sustain = 0.5; // Valor inicial en porcentaje (0.0 a 1.0)
let release = 500; // Valor inicial en milisegundos

// Variables para modos
let isPercussionActive = false;
let isThereminActive = false;
let thereminOption = ''; // 'sintetizador' o 'notas'
let percussionMode = 'umbral'; // 'umbral' o 'automatico'

// Variables para Theremin
let thereminWaveform = 'sine';
let midiInstrument = 'piano';

// Variables para controlar las dinámicas en Theremin Notas
let dynamicsWithWink = false;
let dynamicsWithMouth = false;

// Inicializar Tone.js
const synth = new Tone.PolySynth(Tone.Synth).toDestination();
let thereminOscillator;
let thereminGain;
let thereminVolume = new Tone.Volume(0).toDestination();
let isThereminPlaying = false;

// Crear Gain Node para el instrumento del Theremin Notas
let thereminInstrumentGain = new Tone.Gain(1).toDestination();

// Instrumentos MIDI para el Theremin - Modo Notas
const instrumentOptions = {
    piano: new Tone.Sampler({
        urls: {
            "A2": "https://cdn.freesound.org/previews/83/83114_95830-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    pad: new Tone.Sampler({
        urls: {
            "A3": "https://cdn.freesound.org/previews/636/636873_5544184-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    flauta: new Tone.Sampler({
        urls: {
            "C3": "https://cdn.freesound.org/previews/654/654712_11532701-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    trumpet: new Tone.Sampler({
        urls: {
            "A#3": "https://cdn.freesound.org/previews/654/654712_11532701-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    marimba: new Tone.Sampler({
        urls: {
            "A3": "https://cdn.freesound.org/previews/577/577688_4617272-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    harmonic: new Tone.Sampler({
        urls: {
            "B3": "https://cdn.freesound.org/previews/214/214298_2296865-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    guitar: new Tone.Sampler({
        urls: {
            "C4": "https://cdn.freesound.org/previews/681/681922_5674468-lq.mp3",
            "F4": "https://cdn.freesound.org/previews/681/681927_5674468-lq.mp3",
            "A4": "https://cdn.freesound.org/previews/681/681931_5674468-lq.mp3",
            "C5": "https://cdn.freesound.org/previews/681/681934_5674468-lq.mp3",
            "F5": "https://cdn.freesound.org/previews/681/681939_5674468-lq.mp3",
            "A5": "https://cdn.freesound.org/previews/681/681943_5674468-lq.mp3"
        },
        release: 1
    }).connect(thereminInstrumentGain),

    bass: new Tone.Sampler({
        urls: {
            "C2": "https://cdn.freesound.org/previews/739/739978_6603437-lq.mp3",
            "G3": "https://cdn.freesound.org/previews/739/739977_6603437-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    choir: new Tone.Sampler({
        urls: {
            "C#4": "https://cdn.freesound.org/previews/162/162168_2602967-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    synthesizer: new Tone.Sampler({
        urls: {
            "D#3": "https://cdn.freesound.org/previews/314/314932_2050105-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    musicBox: new Tone.Sampler({
        urls: {
            "A3": "https://cdn.freesound.org/previews/9/9276_1407-lq.mp3",
            "D3": "https://cdn.freesound.org/previews/9/9279_1407-lq.mp3",
            "D4": "https://cdn.freesound.org/previews/9/9278_1407-lq.mp3",
            "G4": "https://cdn.freesound.org/previews/9/9282_1407-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    strings: new Tone.Sampler({
        urls: {
            "B3": "https://cdn.freesound.org/previews/372/372816_2475994-lq.mp3"
        }
    }).connect(thereminInstrumentGain),

    stringSpicatto: new Tone.Sampler({
        urls: {
            "A#3": "https://cdn.freesound.org/previews/374/374391_2475994-lq.mp3"
        }
    }).connect(thereminInstrumentGain)
};

let thereminInstrument = instrumentOptions[midiInstrument];

// Variable para almacenar los valores actuales de los gestos
let currentGestureValues = {};

// Verificar la carga del instrumento inicial
checkIfInstrumentLoaded();

// Inicializar MIDI
navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);

function onMIDISuccess(midi) {
    midiAccess = midi;
    const outputs = Array.from(midiAccess.outputs.values());
    const midiOutputSelect = document.getElementById('midiOutputSelect');
    const midiStatusIndicator = document.getElementById('midiStatusIndicator');

    // Agregar una opción predeterminada "Seleccionar salida MIDI"
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.text = "Seleccionar salida MIDI";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    midiOutputSelect.appendChild(defaultOption);

    // Añadir las opciones de salida MIDI
    outputs.forEach(output => {
        const option = document.createElement('option');
        option.value = output.id;
        option.text = output.name;
        midiOutputSelect.appendChild(option);
    });

    midiOutputSelect.addEventListener('change', (e) => {
        midiOutput = outputs.find(output => output.id === e.target.value);
        if (midiOutput) {
            console.log("MIDI conectado: ", midiOutput.name);
            midiStatusIndicator.style.backgroundColor = 'green';
            pingMidiConnection();
        } else {
            console.log("No se seleccionó salida MIDI");
            midiStatusIndicator.style.backgroundColor = 'red';
        }
    });

    // Mostrar un mensaje si no se encontraron dispositivos MIDI
    if (outputs.length === 0) {
        console.error("No se encontró dispositivo de salida MIDI.");
    }
}

function onMIDIFailure() {
    console.error("Error al acceder a dispositivos MIDI.");
}

function pingMidiConnection() {
    if (midiOutput) {
        try {
            midiOutput.send([0xF8]);
            console.log("Ping MIDI enviado exitosamente.");
        } catch (error) {
            console.error("Error al enviar ping MIDI:", error);
            document.getElementById('midiStatusIndicator').style.backgroundColor = 'red';
        }
    }
}

function setupEnvelopeControls() {
    const attackSlider = document.getElementById("attackSlider");
    const decaySlider = document.getElementById("decaySlider");
    const sustainSlider = document.getElementById("sustainSlider");
    const releaseSlider = document.getElementById("releaseSlider");

    attackSlider.addEventListener("input", () => {
        attack = parseInt(attackSlider.value);
        document.getElementById("attackValue").innerText = attack;
        console.log(`Attack set to: ${attack}`);
    });

    decaySlider.addEventListener("input", () => {
        decay = parseInt(decaySlider.value);
        document.getElementById("decayValue").innerText = decay;
        console.log(`Decay set to: ${decay}`);
    });

    sustainSlider.addEventListener("input", () => {
        sustain = parseFloat(sustainSlider.value);
        document.getElementById("sustainValue").innerText = sustain.toFixed(2);
        console.log(`Sustain set to: ${sustain}`);
    });

    releaseSlider.addEventListener("input", () => {
        release = parseInt(releaseSlider.value);
        document.getElementById("releaseValue").innerText = release;
        console.log(`Release set to: ${release}`);
    });
}

// Función de configuración
function setup() {
    createCanvas(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3)).parent('videoContainer');
    video = createCapture(VIDEO);
    video.size(width, height);
    video.hide();

    faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.95,
        minTrackingConfidence: 0.95,
    });
    faceMesh.onResults(onResults);

    setupCamera();
    setupGestureButtons();
    setupScalingInputs();
    setupMinChangeInputs();
    setupUmbralInputs();
    setupScaleSelection();
    setupRootNoteSelection();
    setupModeControls();
    setupInstructionButton();
    setupPresentationModeButton();
    setupEnvelopeSliders(); 

    // Evento para cerrar el modo presentación
    document.getElementById('closePresentationButton').addEventListener('click', deactivatePresentationMode);

    // Escuchar la tecla "Escape" para cerrar el modo presentación
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            deactivatePresentationMode();
        }
    });
}

// Configuración de los sliders de la envolvente
function setupEnvelopeSliders() {
    const envelopeParams = ['attack', 'decay', 'sustain', 'release'];

    envelopeParams.forEach(param => {
        const slider = document.getElementById(`${param}Slider`);
        const valueDisplay = document.getElementById(`${param}Value`);

        slider.addEventListener('input', (e) => {
            let value = parseFloat(e.target.value);
            window[param] = value; // Actualiza la variable global correspondiente

            if (param === 'sustain') {
                valueDisplay.innerText = value.toFixed(2);
                console.log(`${param} actualizado a: ${value}`);
            } else {
                valueDisplay.innerText = `${value} ms`;
                console.log(`${param} actualizado a: ${value}`);
            }

            // Enviar mensaje MIDI si el Control está activo para este parámetro
            if (controlGestures[param]) {
                let midiValue;
                if (param === 'sustain') {
                    midiValue = Math.round(value * 127); // 'sustain' es un valor entre 0 y 1
                } else {
                    // Mapear el valor al rango MIDI 0-127 basado en el máximo del slider
                    midiValue = Math.round((value / parseFloat(slider.max)) * 127);
                }
                sendContinuousMIDI(param, midiValue);
            }
        });
    });
}


function setupCamera() {
    const camera = new Camera(video.elt, {
        onFrame: async () => {
            await faceMesh.send({ image: video.elt });
        },
        width: 640,
        height: 480,
    });
    camera.start();
}

// Configurar botones de gestos
function setupGestureButtons() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        // Mute button
        const muteButton = document.getElementById(`${gesture}Mute`);
        if (muteButton) {
            muteButton.addEventListener('click', () => {
                muteGestures[gesture] = !muteGestures[gesture];
                muteButton.classList.toggle('active', muteGestures[gesture]);
                console.log(`${gesture} ${muteGestures[gesture] ? 'muted' : 'unmuted'}`);
            });
        }

        // Solo button
        const soloButton = document.getElementById(`${gesture}Solo`);
        if (soloButton) {
            soloButton.addEventListener('click', () => {
                soloGestures[gesture] = !soloGestures[gesture];
                soloButton.classList.toggle('active', soloGestures[gesture]);
                if (soloGestures[gesture]) {
                    gestures.forEach(g => {
                        if (g !== gesture) {
                            muteGestures[g] = true;
                            const muteBtn = document.getElementById(`${g}Mute`);
                            if (muteBtn) muteBtn.classList.add('active');
                        }
                    });
                } else {
                    gestures.forEach(g => {
                        if (g !== gesture) {
                            muteGestures[g] = false;
                            const muteBtn = document.getElementById(`${g}Mute`);
                            if (muteBtn) muteBtn.classList.remove('active');
                        }
                    });
                }
                console.log(`${gesture} solo ${soloGestures[gesture] ? 'activado' : 'desactivado'}`);
            });
        }

        // Control button
        const controlButton = document.getElementById(`${gesture}Control`);
        const ccDisplay = document.getElementById(`${gesture}CC`);
        if (controlButton) {
            controlButton.addEventListener('click', () => {
                controlGestures[gesture] = !controlGestures[gesture];
                controlButton.classList.toggle('active', controlGestures[gesture]);
                if (controlGestures[gesture] && ccDisplay) {
                    ccDisplay.innerText = `CC${gestureCCNumbers[gesture]}`;
                } else if (ccDisplay) {
                    ccDisplay.innerText = '';
                }
                if (controlGestures[gesture]) {
                    notasGestures[gesture] = false;
                    disparadorGestures[gesture] = false;
                    const notasButton = document.getElementById(`${gesture}Notas`);
                    const disparadorButton = document.getElementById(`${gesture}Disparador`);
                    if (notasButton) notasButton.classList.remove('active');
                    if (disparadorButton) disparadorButton.classList.remove('active');
                }
                console.log(`${gesture} control ${controlGestures[gesture] ? 'activado' : 'desactivado'}`);
            });
        }

        // Notas button
        const notasButton = document.getElementById(`${gesture}Notas`);
        if (notasButton) {
            notasButton.addEventListener('click', () => {
                notasGestures[gesture] = !notasGestures[gesture];
                notasButton.classList.toggle('active', notasGestures[gesture]);
                if (notasGestures[gesture]) {
                    controlGestures[gesture] = false;
                    disparadorGestures[gesture] = false;
                    const controlButton = document.getElementById(`${gesture}Control`);
                    const disparadorButton = document.getElementById(`${gesture}Disparador`);
                    if (controlButton) controlButton.classList.remove('active');
                    if (disparadorButton) disparadorButton.classList.remove('active');
                    if (ccDisplay) ccDisplay.innerText = '';
                }
                console.log(`${gesture} notas ${notasGestures[gesture] ? 'activado' : 'desactivado'}`);
            });
        }

        // Disparador button
        const disparadorButton = document.getElementById(`${gesture}Disparador`);
        if (disparadorButton) {
            disparadorButton.addEventListener('click', () => {
                disparadorGestures[gesture] = !disparadorGestures[gesture];
                disparadorButton.classList.toggle('active', disparadorGestures[gesture]);
                if (disparadorGestures[gesture]) {
                    controlGestures[gesture] = false;
                    notasGestures[gesture] = false;
                    const controlButton = document.getElementById(`${gesture}Control`);
                    const notasButton = document.getElementById(`${gesture}Notas`);
                    if (controlButton) controlButton.classList.remove('active');
                    if (notasButton) notasButton.classList.remove('active');
                    if (ccDisplay) ccDisplay.innerText = '';
                }
                console.log(`${gesture} disparador ${disparadorGestures[gesture] ? 'activado' : 'desactivado'}`);
            });
        }

        // Scaling button
        const scalingButton = document.getElementById(`${gesture}Scaling`);
        if (scalingButton) {
            scalingButton.addEventListener('click', () => {
                scalingGestures[gesture] = !scalingGestures[gesture];
                scalingButton.classList.toggle('active', scalingGestures[gesture]);
                console.log(`${gesture} escalado ${scalingGestures[gesture] ? 'activado' : 'desactivado'}`);
            });
        }
    });

    // Configuración para los parámetros de envolvente: attack, decay, sustain, release
const envelopeParams = ['attack', 'decay', 'sustain', 'release'];
envelopeParams.forEach(param => {
    const muteButton = document.getElementById(`${param}Mute`);
    const soloButton = document.getElementById(`${param}Solo`);
    const controlButton = document.getElementById(`${param}Control`);
    const ccDisplay = document.getElementById(`${param}CC`);

    if (muteButton) {
        muteButton.addEventListener('click', () => {
            muteGestures[param] = !muteGestures[param];
            muteButton.classList.toggle('active', muteGestures[param]);
            console.log(`${param} ${muteGestures[param] ? 'muted' : 'unmuted'}`);
        });
    }

    if (soloButton) {
        soloButton.addEventListener('click', () => {
            soloGestures[param] = !soloGestures[param];
            soloButton.classList.toggle('active', soloGestures[param]);
            if (soloGestures[param]) {
                envelopeParams.forEach(p => {
                    if (p !== param) {
                        muteGestures[p] = true;
                        const muteBtn = document.getElementById(`${p}Mute`);
                        if (muteBtn) muteBtn.classList.add('active');
                    }
                });
            } else {
                envelopeParams.forEach(p => {
                    if (p !== param) {
                        muteGestures[p] = false;
                        const muteBtn = document.getElementById(`${p}Mute`);
                        if (muteBtn) muteBtn.classList.remove('active');
                    }
                });
            }
            console.log(`${param} solo ${soloGestures[param] ? 'activado' : 'desactivado'}`);
        });
    }

    if (controlButton) {
        controlButton.addEventListener('click', () => {
            controlGestures[param] = !controlGestures[param];
            controlButton.classList.toggle('active', controlGestures[param]);
            if (controlGestures[param] && ccDisplay) {
                ccDisplay.innerText = `CC${gestureCCNumbers[param]}`;
            } else if (ccDisplay) {
                ccDisplay.innerText = '';
            }
            console.log(`${param} control ${controlGestures[param] ? 'activado' : 'desactivado'}`);
        });
    }
});
}

// Configurar inputs de escalado
function setupScalingInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const minInput = document.getElementById(`${gesture}Min`);
        const maxInput = document.getElementById(`${gesture}Max`);
        minInput.addEventListener('change', () => {
            gestureRanges[gesture].min = parseFloat(minInput.value) || gestureRanges[gesture].min;
        });
        maxInput.addEventListener('change', () => {
            gestureRanges[gesture].max = parseFloat(maxInput.value) || gestureRanges[gesture].max;
        });
    });
}

// Configurar inputs de cambio mínimo
function setupMinChangeInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const minChangeInput = document.getElementById(`${gesture}MinChange`);
        minChangeInput.addEventListener('change', () => {
            gestureMinChanges[gesture] = parseFloat(minChangeInput.value) || gestureMinChanges[gesture];
        });
    });
}

// Configurar inputs de Umbral
function setupUmbralInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const umbralInput = document.getElementById(`${gesture}Umbral`);
        umbralInput.addEventListener('change', () => {
            gestureUmbrales[gesture] = parseFloat(umbralInput.value) || gestureUmbrales[gesture];
        });
    });
}

// Configurar selección de escala
function setupScaleSelection() {
    const scaleSelect = document.getElementById('scaleSelect');

    // Set 'major' as the selected scale and ensure it displays correctly
    selectedScale = 'major';
    scaleSelect.value = selectedScale;

    // Event listener to update `selectedScale` when the user changes it
    scaleSelect.addEventListener('change', () => {
        selectedScale = scaleSelect.value;
    });
}

// Configurar selección de nota fundamental
function setupRootNoteSelection() {
    const rootNoteSelect = document.getElementById('rootNoteSelect');
    rootNoteSelect.addEventListener('change', () => {
        rootNote = rootNoteSelect.value;
    });
}

// Configurar controles de modo
function setupModeControls() {
    const percussionToggle = document.getElementById('percussionToggle');
    const percussionOptions = document.getElementById('percussionOptions');
    const percussionModeSelect = document.getElementById('percussionModeSelect');

    percussionToggle.addEventListener('click', () => {
        isPercussionActive = !isPercussionActive;
        percussionToggle.classList.toggle('active', isPercussionActive);
        if (isPercussionActive) {
            percussionOptions.classList.add('active');
            const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
            gestures.forEach(gesture => {
                disparadorGestures[gesture] = true;
                const disparadorButton = document.getElementById(`${gesture}Disparador`);
                disparadorButton.classList.add('active');
            });
            console.log('Percusión activada');
        } else {
            percussionOptions.classList.remove('active');
            const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
            gestures.forEach(gesture => {
                disparadorGestures[gesture] = false;
                const disparadorButton = document.getElementById(`${gesture}Disparador`);
                disparadorButton.classList.remove('active');
            });
            console.log('Percusión desactivada');
        }
    });

    percussionModeSelect.addEventListener('change', () => {
        percussionMode = percussionModeSelect.value;
        console.log(`Modo Percusión: ${percussionMode}`);
    });

    const thereminToggle = document.getElementById('thereminToggle');
    const thereminModeOptions = document.getElementById('thereminModeOptions');
    const thereminSynthOption = document.getElementById('thereminSynthOption');
    const thereminNotesOption = document.getElementById('thereminNotesOption');
    const thereminSynthOptions = document.getElementById('thereminSynthOptions');
    const thereminNotesOptions = document.getElementById('thereminNotesOptions');
    const waveformSelect = document.getElementById('waveformSelect');
    const midiInstrumentSelect = document.getElementById('midiInstrumentSelect');

    // Botones para Dinámicas en Theremin Notas
    let dynamicsWithWinkButton;
    let dynamicsWithMouthButton;

    thereminToggle.addEventListener('click', () => {
        isThereminActive = !isThereminActive;
        thereminToggle.classList.toggle('active', isThereminActive);
        if (isThereminActive) {
            thereminModeOptions.classList.add('active');
            console.log('Theremin activado');
            // Resumir el contexto de audio si no está en ejecución
            if (Tone.context.state !== 'running') {
                Tone.context.resume();
            }
        } else {
            thereminModeOptions.classList.remove('active');
            thereminOption = '';
            if (isThereminPlaying) {
                thereminOscillator.stop();
                isThereminPlaying = false;
            }
            notasGestures['mouthOpen'] = false;
            const mouthOpenNotasButton = document.getElementById('mouthOpenNotas');
            mouthOpenNotasButton.classList.remove('active');

            // Ocultar botones de dinámica si estaban visibles
            if (dynamicsWithWinkButton) dynamicsWithWinkButton.style.display = 'none';
            if (dynamicsWithMouthButton) dynamicsWithMouthButton.style.display = 'none';
        }
    });

    thereminSynthOption.addEventListener('click', () => {
        thereminOption = 'sintetizador';
        thereminSynthOptions.style.display = 'block';
        thereminNotesOptions.style.display = 'none';
        notasGestures['mouthOpen'] = false;
        const mouthOpenNotasButton = document.getElementById('mouthOpenNotas');
        mouthOpenNotasButton.classList.remove('active');

        // Reiniciar estado del oscilador
        if (isThereminPlaying) {
            thereminOscillator.stop();
            isThereminPlaying = false;
        }

        // Ocultar botones de dinámica si estaban visibles
        if (dynamicsWithWinkButton) dynamicsWithWinkButton.style.display = 'none';
        if (dynamicsWithMouthButton) dynamicsWithMouthButton.style.display = 'none';

        console.log('Theremin opción Synth seleccionada');
    });

    thereminNotesOption.addEventListener('click', () => {
        thereminOption = 'notas';
        thereminSynthOptions.style.display = 'none';
        thereminNotesOptions.style.display = 'block';
        notasGestures['mouthOpen'] = true;
        const mouthOpenNotasButton = document.getElementById('mouthOpenNotas');
        mouthOpenNotasButton.classList.add('active');

        // Asegurarse de que el oscilador del theremin se detiene
        if (isThereminPlaying) {
            thereminOscillator.stop();
            isThereminPlaying = false;
        }

        console.log('Theremin opción Notas seleccionada');

        // Crear y mostrar botones de dinámica
        if (!dynamicsWithWinkButton) {
            dynamicsWithWinkButton = document.createElement('button');
            dynamicsWithWinkButton.id = 'dynamicsWithWinkButton';
            dynamicsWithWinkButton.classList.add('toggle-button');
            dynamicsWithWinkButton.innerText = 'Dinámicas con Guiño';
            thereminNotesOptions.appendChild(dynamicsWithWinkButton);

            dynamicsWithWinkButton.addEventListener('click', () => {
                dynamicsWithWink = !dynamicsWithWink;
                dynamicsWithWinkButton.classList.toggle('active', dynamicsWithWink);
                if (dynamicsWithWink) {
                    dynamicsWithMouth = false;
                    if (dynamicsWithMouthButton) dynamicsWithMouthButton.classList.remove('active');
                }
                console.log(`Dinámicas con Guiño: ${dynamicsWithWink ? 'activado' : 'desactivado'}`);
            });
        } else {
            dynamicsWithWinkButton.style.display = 'inline-block';
        }

        if (!dynamicsWithMouthButton) {
            dynamicsWithMouthButton = document.createElement('button');
            dynamicsWithMouthButton.id = 'dynamicsWithMouthButton';
            dynamicsWithMouthButton.classList.add('toggle-button');
            dynamicsWithMouthButton.innerText = 'Dinámicas con Boca';
            thereminNotesOptions.appendChild(dynamicsWithMouthButton);

            dynamicsWithMouthButton.addEventListener('click', () => {
                dynamicsWithMouth = !dynamicsWithMouth;
                dynamicsWithMouthButton.classList.toggle('active', dynamicsWithMouth);
                if (dynamicsWithMouth) {
                    dynamicsWithWink = false;
                    if (dynamicsWithWinkButton) dynamicsWithWinkButton.classList.remove('active');
                }
                console.log(`Dinámicas con Boca: ${dynamicsWithMouth ? 'activado' : 'desactivado'}`);
            });
        } else {
            dynamicsWithMouthButton.style.display = 'inline-block';
        }
    });

    // Selección de instrumento MIDI
    midiInstrumentSelect.addEventListener('change', () => {
        midiInstrument = midiInstrumentSelect.value;
        thereminInstrument = instrumentOptions[midiInstrument];
        isInstrumentLoaded = false;

        // Verificar la carga del instrumento
        checkIfInstrumentLoaded();
        console.log(`Instrumento ${midiInstrument} configurado.`);
    });

    // Selección de forma de onda
    waveformSelect.addEventListener('change', () => {
        thereminWaveform = waveformSelect.value;
        if (isThereminPlaying && thereminOscillator) {
            thereminOscillator.type = thereminWaveform;
        }
        console.log(`Forma de onda seleccionada: ${thereminWaveform}`);
    });
}

// Configurar botón de instrucciones
function setupInstructionButton() {
    const instructionButton = document.getElementById('instructionButton');
    const instructionModal = document.getElementById('instructionModal');
    const closeModalButton = document.getElementById('closeModalButton');

    instructionButton.addEventListener('click', () => {
        instructionModal.style.display = 'block';
    });

    closeModalButton.addEventListener('click', () => {
        instructionModal.style.display = 'none';
    });
}

// Configurar botón de Modo Presentación
function setupPresentationModeButton() {
    const presentationModeButton = document.getElementById('presentationModeButton');
    const presentationOverlay = document.getElementById('presentationOverlay');
    const closePresentationButton = document.getElementById('closePresentationButton');

    presentationModeButton.addEventListener('click', () => {
        activatePresentationMode();
    });

    closePresentationButton.addEventListener('click', () => {
        deactivatePresentationMode();
    });

    // Escuchar la tecla "Escape" para salir del modo presentación
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            deactivatePresentationMode();
        }
    });
}

function activatePresentationMode() {
    document.body.classList.add('presentation-active');
    document.getElementById('presentationOverlay').style.display = 'block';
    document.getElementById('closePresentationButton').style.display = 'block';

    // Oculta los botones y controles en modo presentación
    document.querySelectorAll('.mode-controls, #instructionButton, .midi-status').forEach(element => {
        element.classList.add('hidden');
    });

    // Redimensiona el canvas y el video para pantalla completa
    resizeCanvas(windowWidth, windowHeight);
    video.size(windowWidth, windowHeight);
}

function deactivatePresentationMode() {
    // Quitar la clase de modo de presentación
    document.body.classList.remove('presentation-active');

    // Restaurar el tamaño del canvas y el video a su tamaño original
    resizeCanvas(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));
    video.size(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));

    // Restaurar la visibilidad de los elementos que estaban ocultos
    document.querySelectorAll('.mode-controls, #instructionButton, .midi-status').forEach(element => {
        element.classList.remove('hidden');
    });

    // Ocultar el overlay de presentación
    document.getElementById('presentationOverlay').style.display = 'none';
    document.getElementById('closePresentationButton').style.display = 'none';
}

// Función para manejar disparadores
function handleGestureDisparador(gesture, currentValue, onDisparador) {
    let umbral = gestureUmbrales[gesture];
    let minChange = gestureMinChanges[gesture];
    let direction = gestureDisparadorDirections[gesture];
    let disparadorState = gestureDisparadorStates[gesture];
    let lastValue = disparadorState.lastValue;
    let currentTime = Date.now();

    if (percussionMode === 'automatico') {
        // Detectar cambios repentinos
        if (lastValue !== null) {
            let change = Math.abs(currentValue - lastValue);
            if (change > minChange && currentTime - disparadorState.lastTriggerTime > 500) {
                onDisparador();
                disparadorState.lastTriggerTime = currentTime;
            }
        }
    } else if (percussionMode === 'umbral') {
        // Modo Umbral
        if (direction === 'ascending') {
            if (disparadorState.armed && lastValue !== null && lastValue < umbral && currentValue >= umbral) {
                onDisparador();
                disparadorState.armed = false;
                disparadorState.lastTriggerTime = currentTime;
            } else if (!disparadorState.armed && currentValue < umbral - minChange) {
                disparadorState.armed = true;
            }
        } else if (direction === 'descending') {
            if (disparadorState.armed && lastValue !== null && lastValue > umbral && currentValue <= umbral) {
                onDisparador();
                disparadorState.armed = false;
                disparadorState.lastTriggerTime = currentTime;
            } else if (!disparadorState.armed && currentValue > umbral + minChange) {
                disparadorState.armed = true;
            }
        }
    }

    // Actualizar lastValue
    disparadorState.lastValue = currentValue;
}

// Función para manejar notas
function handleGestureNotas(gesture, currentValue) {
    let minChange = gestureMinChanges[gesture];
    let lastValue = gestureDisparadorStates[gesture].lastValue || 0;
    let noteIndex = Math.floor((currentValue - gestureRanges[gesture].min) / minChange);
    let lastNoteIndex = Math.floor((lastValue - gestureRanges[gesture].min) / minChange);

    if (noteIndex !== lastNoteIndex) {
        if (gestureActiveNotes[gesture]) {
            sendMIDINoteOff(gestureActiveNotes[gesture]);
            gestureActiveNotes[gesture] = null;
        }
        let midiNote = quantizeToScale(currentValue, gesture);
        if (midiNote !== null) {
            // Enviar mensaje MIDI
            sendMIDINoteOn(midiNote);
            // Reproducir sonido en el navegador si el theremin "notas" está activo
            if (isThereminActive && thereminOption === 'notas') {
                playSynthNoteWhenReady(midiNote);
            }
            gestureActiveNotes[gesture] = midiNote;
        }
    }

    gestureDisparadorStates[gesture].lastValue = currentValue;
}

function sendMIDINoteOn(midiNote) {
    if (midiOutput) {
        midiOutput.send([0x90, midiNote, 127]);
        console.log(`MIDI Note On: ${midiNote}`);
        const durationMs = attack + decay + release;

        // Enviar Note Off después de la duración de la envolvente
        setTimeout(() => {
            sendMIDINoteOff(midiNote);
        }, durationMs);
    }
}

function sendMIDINoteOff(midiNote) {
    if (midiOutput) {
        midiOutput.send([0x80, midiNote, 0]);
        console.log(`MIDI Note Off: ${midiNote}`);
    }
}

// Variables para almacenar notas activas por gesto
let gestureActiveNotes = {
    mouthOpen: null,
    smile: null,
    leftWink: null,
    rightWink: null,
    noseX: null,
    noseY: null,
};

// Función para detectar gestos
function detectGestures(landmarks) {
    // Procesar cada gesto de acuerdo a los estados y configuraciones
    processMouthOpen(landmarks);
    processSmile(landmarks);
    processLeftWink(landmarks);
    processRightWink(landmarks);
    processNoseX(landmarks);
    processNoseY(landmarks);
}

// Funciones de procesamiento para cada gesto
function processMouthOpen(landmarks) {
    const gesture = 'mouthOpen';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const topLip = landmarks[13];
    const bottomLip = landmarks[14];
    let mouthOpenValue = dist(topLip.x * width, topLip.y * height, bottomLip.x * width, bottomLip.y * height);

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        mouthOpenValue = map(mouthOpenValue, min, max, 0, 127);
        mouthOpenValue = constrain(mouthOpenValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(mouthOpenValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = mouthOpenValue;

    // Theremin
    if (isThereminActive && thereminOption === 'sintetizador') {
        updateThereminContinuous(mouthOpenValue);
    }

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, mouthOpenValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('C4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, mouthOpenValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, mouthOpenValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = mouthOpenValue;
}

function processSmile(landmarks) {
    const gesture = 'smile';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const leftMouth = landmarks[61];
    const rightMouth = landmarks[291];
    let smileValue = dist(leftMouth.x * width, leftMouth.y * height, rightMouth.x * width, rightMouth.y * height);

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        smileValue = map(smileValue, min, max, 0, 127);
        smileValue = constrain(smileValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(smileValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = smileValue;

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, smileValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('D4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, smileValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, smileValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = smileValue;
}

function processLeftWink(landmarks) {
    const gesture = 'leftWink';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const leftEyeTop = landmarks[159];
    const leftEyeBottom = landmarks[145];
    let leftWinkValue = dist(leftEyeTop.x * width, leftEyeTop.y * height, leftEyeBottom.x * width, leftEyeBottom.y * height);

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        leftWinkValue = map(leftWinkValue, min, max, 0, 127);
        leftWinkValue = constrain(leftWinkValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(leftWinkValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = leftWinkValue;

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, leftWinkValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('E4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, leftWinkValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, leftWinkValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = leftWinkValue;
}

function processRightWink(landmarks) {
    const gesture = 'rightWink';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const rightEyeTop = landmarks[386];
    const rightEyeBottom = landmarks[374];
    let rightWinkValue = dist(rightEyeTop.x * width, rightEyeTop.y * height, rightEyeBottom.x * width, rightEyeBottom.y * height);

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        rightWinkValue = map(rightWinkValue, min, max, 0, 127);
        rightWinkValue = constrain(rightWinkValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(rightWinkValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = rightWinkValue;

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, rightWinkValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('F4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rightWinkValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, rightWinkValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = rightWinkValue;
}

function processNoseX(landmarks) {
    const gesture = 'noseX';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const nose = landmarks[1];
    let noseXValue = nose.x * width;

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        noseXValue = map(noseXValue, min, max, 0, 127);
        noseXValue = constrain(noseXValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(noseXValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = noseXValue;

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, noseXValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('G4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, noseXValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, noseXValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = noseXValue;
}

function processNoseY(landmarks) {
    const gesture = 'noseY';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const nose = landmarks[1];
    let noseYValue = nose.y * height;

    // Escalar si está activo
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        noseYValue = map(noseYValue, min, max, 0, 127);
        noseYValue = constrain(noseYValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(noseYValue));

    // Almacenar valor actual
    currentGestureValues[gesture] = noseYValue;

    // Percusión y Disparador
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, noseYValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('A4'));
            }
        });
    }

    // Notas
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, noseYValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, noseYValue);
    }

    // Actualizar lastValue
    gestureDisparadorStates[gesture].lastValue = noseYValue;
}

// Función para verificar si un gesto está en solo
function isGestureSolo(gesture) {
    return soloGestures[gesture] && Object.values(soloGestures).filter(v => v).length === 1;
}

// Función para actualizar Theremin en modo Synth
function updateThereminContinuous(mouthValue) {
    const frequency = map(mouthValue, 0, 127, 100, 1000); // Ajustar rango de frecuencia
    const leftWinkValue = currentGestureValues['leftWink'] || 0;
    const rightWinkValue = currentGestureValues['rightWink'] || 0;
    const winkAverage = (leftWinkValue + rightWinkValue) / 2;

    // Calcular volumen basado en el promedio de los guiños
    let volume;
    let volumeDb;

    if (winkAverage < 10 || mouthValue === 0) {
        volume = 0; // Silencio
        volumeDb = -Infinity;
    } else if (winkAverage >= 40) {
        volumeDb = -6; // Volumen máximo (-6 dB)
        volume = Tone.dbToGain(volumeDb);
    } else {
        volumeDb = map(winkAverage, 10, 40, -40, -6); // Ajustar rango de volumen
        volume = Tone.dbToGain(volumeDb);
    }

    if (!isThereminPlaying) {
        thereminGain = new Tone.Gain(volume).toDestination();
        thereminOscillator = new Tone.Oscillator(frequency, thereminWaveform).connect(thereminGain);
        thereminOscillator.start();
        isThereminPlaying = true;
    } else {
        thereminOscillator.frequency.value = frequency;
    }

    // Usar una rampa suave para evitar clicks
    thereminGain.gain.rampTo(volume, 0.05);

    // Detener el oscilador si el volumen es 0 y está sonando
    if (volumeDb === -Infinity && isThereminPlaying) {
        thereminGain.gain.rampTo(0, 0.05);
        setTimeout(() => {
            thereminOscillator.stop();
            isThereminPlaying = false;
        }, 100);
    }
}

// Función para reproducir nota cuando el instrumento esté cargado
function playSynthNoteWhenReady(midiNote) {
    if (!isInstrumentLoaded) {
        console.warn("Instrumento no cargado aún. Reintentando en 200ms.");
        setTimeout(() => playSynthNoteWhenReady(midiNote), 200);
        return;
    }
    playSynthNoteWithDynamics(midiNote);
}

// Función para reproducir nota con dinámicas
function playSynthNoteWithDynamics(midiNote) {
    const noteName = midiToNoteName(midiNote);
    const now = Tone.now();

    try {
        if (thereminOption === 'notas' && thereminInstrument instanceof Tone.Sampler) {
            // Configurar el tiempo de release
            thereminInstrument.release = release / 1000;

            // Calcular la duración total de la nota
            const noteDuration = attack / 1000 + decay / 1000 + release / 1000;

            // Calcular volumen según dinámicas
            let volumeDb = -6; // Volumen máximo por defecto (-6 dB)
            let volume = Tone.dbToGain(volumeDb);

            if (dynamicsWithWink) {
                const leftWinkValue = currentGestureValues['leftWink'] || 0;
                const rightWinkValue = currentGestureValues['rightWink'] || 0;
                const winkAverage = (leftWinkValue + rightWinkValue) / 2;

                if (winkAverage < 10) {
                    volumeDb = -Infinity; // Silencio
                    volume = 0;
                } else if (winkAverage >= 40) {
                    volumeDb = -6; // Volumen máximo (-6 dB)
                    volume = Tone.dbToGain(volumeDb);
                } else {
                    volumeDb = map(winkAverage, 10, 40, -40, -6);
                    volume = Tone.dbToGain(volumeDb);
                }
            } else if (dynamicsWithMouth) {
                const mouthValue = currentGestureValues['mouthOpen'] || 0;

                if (mouthValue === 0) {
                    volumeDb = -Infinity; // Silencio
                    volume = 0;
                } else {
                    volumeDb = map(mouthValue, 0, 127, -40, -6);
                    volume = Tone.dbToGain(volumeDb);
                }
            }

            // Reproducir la nota con la duración y volumen especificados
            if (volume > 0) {
                thereminInstrument.volume.value = Tone.gainToDb(volume);
                thereminInstrument.triggerAttackRelease(noteName, noteDuration, now);
                console.log(`Reproduciendo ${noteName} con volumen: ${thereminInstrument.volume.value} dB`);
            } else {
                // No reproducir si el volumen es 0 (silencio)
                console.log(`Volumen en silencio, no se reproduce la nota ${noteName}`);
            }
        } else {
            console.error("thereminOption o thereminInstrument no configurado correctamente.");
        }
    } catch (error) {
        console.error("Error en playSynthNote:", error);
    }
}

// Funciones auxiliares
function sendContinuousMIDI(gestureOrParam, value) {
    const midiValue = Math.min(127, Math.max(0, Math.round(value)));
    const controlNumber = gestureCCNumbers[gestureOrParam];
    if (midiOutput && controlNumber !== undefined) {
        midiOutput.send([0xB0, controlNumber, midiValue]);
        console.log(`MIDI CC enviado: ${gestureOrParam} Valor ${midiValue}`);
    }
}


function quantizeToScale(value, gesture) {
    const min = gestureRanges[gesture].min;
    const max = gestureRanges[gesture].max;
    const minChange = gestureMinChanges[gesture];
    const scaleNotes = scales[selectedScale];
    const numNotes = scaleNotes.length;
    const rootMidi = noteNameToMidi(rootNote + '3'); // Base octave 3

    // Map value to MIDI range
    const mappedValue = map(value, min, max, 0, 127);
    const index = Math.floor(mappedValue / minChange);

    // Calculate octave and note in scale
    const octave = Math.floor(index / numNotes);
    const noteInScale = scaleNotes[index % numNotes];
    const midiNote = rootMidi + (octave * 12) + noteInScale;

    if (midiNote >= 0 && midiNote <= 127) {
        return midiNote;
    } else {
        return null;
    }
}

const percussionMap = {
    mouthOpen: new Tone.Player("https://cdn.freesound.org/previews/587/587239_911455-lq.mp3").toDestination(), // Bombo
    smile: new Tone.Player("https://cdn.freesound.org/previews/103/103365_1225281-lq.mp3").toDestination(),    // Tambor
    leftWink: new Tone.Player("https://cdn.freesound.org/previews/669/669735_5819399-lq.mp3").toDestination(), // Tom bajo
    rightWink: new Tone.Player("https://cdn.freesound.org/previews/441/441645_4157918-lq.mp3").toDestination(),  // Tom alto
    noseX: new Tone.Player("https://cdn.freesound.org/previews/640/640031_3655844-lq.mp3").toDestination(),     // Crash
    noseY: new Tone.Player("https://cdn.freesound.org/previews/431/431518_4766646-lq.mp3").toDestination(),     // Ride
};

function playPercussionSound(gesture) {
    const player = percussionMap[gesture];
    if (player) {
        player.start();
    }
}

function midiToNoteName(midiNote) {
    const octave = Math.floor(midiNote / 12) - 1;
    const noteIndex = midiNote % 12;
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return noteNames[noteIndex] + octave;
}

function noteNameToMidi(noteName) {
    const noteMap = {
        'C': 0,
        'C#': 1,
        'D': 2,
        'D#': 3,
        'E': 4,
        'F': 5,
        'F#': 6,
        'G': 7,
        'G#': 8,
        'A': 9,
        'A#': 10,
        'B': 11,
    };
    const regex = /^([A-G]#?)(\d)$/;
    const match = noteName.match(regex);
    if (match) {
        const note = match[1];
        const octave = parseInt(match[2]);
        return (octave + 1) * 12 + noteMap[note];
    }
    return 60; // Valor por defecto si falla el análisis
}

function updateGestureValueDisplay(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerText = value;
    }
}

function onResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        const smoothedLandmarks = smoothLandmarks(landmarks);
        currentLandmarks = smoothedLandmarks; // Guardar para usar en draw()
        detectGestures(smoothedLandmarks);
    } else {
        currentLandmarks = null; // No hay landmarks
    }
}

function smoothLandmarks(landmarks) {
    return landmarks.map((landmark, index) => {
        if (!gestureStability[index]) {
            gestureStability[index] = { x: landmark.x, y: landmark.y, z: landmark.z };
        }
        gestureStability[index].x = lerp(gestureStability[index].x, landmark.x, 0.4);
        gestureStability[index].y = lerp(gestureStability[index].y, landmark.y, 0.4);
        gestureStability[index].z = lerp(gestureStability[index].z, landmark.z, 0.4);
        return gestureStability[index];
    });
}

function drawLandmarks(landmarks) {
    for (let i = 0; i < landmarks.length; i++) {
        // Refleja las coordenadas horizontales
        const x = width - (landmarks[i].x * width);
        const y = landmarks[i].y * height;
        fill(0, 255, 0);
        noStroke();
        ellipse(x, y, 3, 3);
    }
}

// Función para dibujar
function draw() {
    // Restablece el modo de mezcla al predeterminado para asegurar colores plenos
    blendMode(BLEND);
    background(0);
    if (currentLandmarks) {
        drawLandmarks(currentLandmarks);
    }
}

// Función para verificar la carga del instrumento
function checkIfInstrumentLoaded() {
    if (thereminInstrument.loaded) {
        isInstrumentLoaded = true;
        console.log("Instrumento completamente cargado.");
    } else {
        console.warn("Esperando a que el instrumento se cargue. Reintentando en 100 ms.");
        setTimeout(checkIfInstrumentLoaded, 100);
    }
}
