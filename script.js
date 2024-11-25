// Global variables
let video;
let faceMesh;
let midiAccess;
let midiOutput = null;
let lastNoseY = null;
let lastNoseX = null;
let restFaceCounter = 0;
let activeGesture = null;
let gestureCoolDown = {};
let gestureStability = {};
let currentLandmarks = null; // Variable to store landmarks
let isInstrumentLoaded = false;
let amplitudeEnvelope;
let velocityGain;
let sustainDuration = 2000; // Initial sustain duration in milliseconds
let currentGestureValues = {}; // Variable to store current gesture values
let thereminEnvelope;
let midiInstrumentSelect;

// Gesture states
let controlGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
    attack: false,
    decay: false,
    sustain: false,
    sustainDuration: false,
    release: false,
};

let muteGestures = {
    mouthOpen: false,
    smile: true,       
    leftWink: true,
    rightWink: true,
    noseX: true,
    noseY: true,
    attack: false,
    decay: false,
    sustain: false,
    sustainDuration: false,
    release: false,
};
let soloGestures = {
    mouthOpen: true,  // 'mouthOpen' en modo 'solo'
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
    attack: false,
    decay: false,
    sustain: false,
    sustainDuration: false,
    release: false,
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

// Thresholds for Trigger (default values, can be adjusted by the user in HTML)
let gestureUmbrales = {
    mouthOpen: 30,
    smile: 30,
    leftWink: 15,
    rightWink: 15,
    noseX: 50,
    noseY: 50,
};

// Variables for scaling
let scalingGestures = {
    mouthOpen: false,
    smile: false,
    leftWink: false,
    rightWink: false,
    noseX: false,
    noseY: false,
};

// Minimum and maximum range for scaling (can be adjusted by the user in HTML)
let gestureRanges = {
    mouthOpen: { min: 20, max: 200 },
    smile: { min: 20, max: 200 },
    leftWink: { min: 20, max: 200 },
    rightWink: { min: 20, max: 200 },
    noseX: { min: 0, max: window.innerWidth },
    noseY: { min: 0, max: window.innerHeight },
};

// Minimum change per gesture (can be adjusted by the user in HTML)
let gestureMinChanges = {
    mouthOpen: 10,
    smile: 10,
    leftWink: 5,
    rightWink: 5,
    noseX: 10,
    noseY: 10,
};

// States for Trigger
let gestureDisparadorStates = {
    mouthOpen: { armed: true, lastValue: null, lastTriggerTime: 0 },
    smile: { armed: true, lastValue: null, lastTriggerTime: 0 },
    leftWink: { armed: true, lastValue: null, lastTriggerTime: 0 },
    rightWink: { armed: true, lastValue: null, lastTriggerTime: 0 },
    noseX: { armed: true, lastValue: null, lastTriggerTime: 0 },
    noseY: { armed: true, lastValue: null, lastTriggerTime: 0 },
};

// Directions for Trigger ('ascending' or 'descending')
let gestureDisparadorDirections = {
    mouthOpen: 'ascending',
    smile: 'ascending',
    leftWink: 'descending',
    rightWink: 'descending',
    noseX: 'ascending',
    noseY: 'ascending',
};

// Variables to store active notes per gesture
let gestureActiveNotes = {
    mouthOpen: null,
    smile: null,
    leftWink: null,
    rightWink: null,
    noseX: null,
    noseY: null,
};

// Variables for musical scales
let selectedScale = 'major';
let rootNote = 'C';

// Scale maps
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

// CC channels assigned to each gesture and envelope parameters
let gestureCCNumbers = {
    mouthOpen: 1,
    smile: 2,
    leftWink: 3,
    rightWink: 4,
    noseX: 5,
    noseY: 6,
    attack: 10,  // CC number for 'attack' control
    decay: 11,   // CC number for 'decay' control
    sustain: 12, // CC number for 'sustain' control
    sustainDuration: 13,
    release: 14  // CC number for 'release' control
};

let attack = 100; // Initial value in milliseconds
let decay = 300;  // Initial value in milliseconds
let sustain = 0.5; // Initial value as a percentage (0.0 to 1.0)
let release = 500; // Initial value in milliseconds

// Variables for modes
let isPercussionActive = false;
let isThereminActive = false;
let thereminOption = ''; // 'synth' or 'notas'
let percussionMode = 'umbral'; // 'umbral' or 'automatico'

// Variables for Theremin
let thereminWaveform = 'sine';
let midiInstrument = 'piano';

// Variables to control dynamics in Theremin Notes
let dynamicsWithWink = false;
let dynamicsWithMouth = false;

// Initialize Tone.js
const synth = new Tone.PolySynth(Tone.Synth).toDestination();
let thereminOscillator;
let thereminGain;
let thereminVolume = new Tone.Volume(0).toDestination();
let isThereminPlaying = false;

// Define polyphony level and samplers array
//const polyphony = 8;


const instrumentOptions = {
    piano: {
        urls: {
            "A2": "https://cdn.freesound.org/previews/83/83114_95830-lq.mp3"
        },
        release: 1
    },
    pad: {
        urls: {
            "A3": "https://cdn.freesound.org/previews/636/636873_5544184-lq.mp3"
        },
        release: 1
    },
    flauta: {
        urls: {
            "C3": "https://cdn.freesound.org/previews/654/654712_11532701-lq.mp3"
        },
        release: 1
    },
    trumpet: {
        urls: {
            "G#3": "https://cdn.freesound.org/previews/487/487480_7295656-lq.mp3"
        },
        release: 1
    },

    marimba: {
        urls: {
            "A3": "https://cdn.freesound.org/previews/577/577688_4617272-lq.mp3"
        }
    },

    harmonic: {
        urls: {
            "B3": "https://cdn.freesound.org/previews/214/214298_2296865-lq.mp3"
        },
        release: 1
    },

    guitar: {
        urls: {
            "C4": "https://cdn.freesound.org/previews/681/681922_5674468-lq.mp3",
            "F4": "https://cdn.freesound.org/previews/681/681927_5674468-lq.mp3",
            "A4": "https://cdn.freesound.org/previews/681/681931_5674468-lq.mp3",
            "C5": "https://cdn.freesound.org/previews/681/681934_5674468-lq.mp3",
            "F5": "https://cdn.freesound.org/previews/681/681939_5674468-lq.mp3",
            "A5": "https://cdn.freesound.org/previews/681/681943_5674468-lq.mp3"
        },
        release: 1
    },

    bass: {
        urls: {
            "C2": "https://cdn.freesound.org/previews/739/739978_6603437-lq.mp3",
            "G3": "https://cdn.freesound.org/previews/739/739977_6603437-lq.mp3"
        }
    },

    choir: {
        urls: {
            "A3": "https://cdn.freesound.org/previews/698/698958_14477833-lq.mp3"
        },
        release: 1
    },

    synthesizer: {
        urls: {
            "C3": "https://cdn.freesound.org/previews/25/25495_146516-lq.mp3"
        },
        release: 1
    },

    musicBox: {
        urls: {
            "A3": "https://cdn.freesound.org/previews/9/9276_1407-lq.mp3",
            "D3": "https://cdn.freesound.org/previews/9/9279_1407-lq.mp3",
            "D4": "https://cdn.freesound.org/previews/9/9278_1407-lq.mp3",
            "G4": "https://cdn.freesound.org/previews/9/9282_1407-lq.mp3"
        }
    },

    strings: {
        urls: {
            "A3": "https://cdn.freesound.org/previews/374/374588_2475994-lq.mp3"
        },
        release: 1
    },

    stringSpicatto:{
        urls: {
            "A#3": "https://cdn.freesound.org/previews/374/374391_2475994-lq.mp3"
        }
    },
};

// Verify the initial instrument loading
checkIfInstrumentLoaded();

// Initialize MIDI
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
} else {
    console.error("Web MIDI API not supported in this browser.");
}

let polySampler;

// Function to initialize samplers based on the selected instrument
function initializeSampler() {
    if (!instrumentOptions[midiInstrument]) {
        console.error(`Instrumento "${midiInstrument}" no encontrado en instrumentOptions.`);
        return;
    }

    // Desechar el sampler existente para prevenir fugas de memoria
    if (polySampler) {
        polySampler.dispose();
    }

    isInstrumentLoaded = false; // Reiniciar la bandera antes de cargar el nuevo instrumento

    // Crear un nuevo sampler con las opciones especificadas
    polySampler = new Tone.Sampler({
        urls: instrumentOptions[midiInstrument].urls,
        release: release / 1000, // Usar el valor del slider de release
        onload: () => {
            isInstrumentLoaded = true;
            console.log(`Sampler cargado para ${midiInstrument}`);
        },
        onerror: (error) => {
            console.error(`Error cargando el sampler para ${midiInstrument}:`, error);
        },
        envelope: {
            attack: attack / 1000,
            decay: decay / 1000,
            sustain: sustain,
            release: release / 1000,
        }
    }).toDestination();
}

// Llamar a initializeSampler al cargar la página
initializeSampler();
checkIfInstrumentLoaded();

// Listener para la selección de instrumento
if (midiInstrumentSelect) {
    midiInstrumentSelect.addEventListener('change', () => {
        midiInstrument = midiInstrumentSelect.value;
        initializeSampler(); // Reinitialize sampler when instrument changes
        console.log(`Instrumento ${midiInstrument} seleccionado y sampler inicializado.`);
    });
}

// MIDI Instruments for Theremin - Notes Mode


function onMIDISuccess(midiAccess) {
    // Listen for changes in MIDI device connections
    midiAccess.onstatechange = (event) => {
        console.log('MIDI device state changed:', event.port.name, event.port.state);
        updateMIDIPorts(midiAccess);
    };
    updateMIDIPorts(midiAccess);
}

function updateMIDIPorts(midiAccess) {
    const outputs = Array.from(midiAccess.outputs.values());
    const midiOutputSelect = document.getElementById('midiOutputSelect');
    const midiStatusIndicator = document.getElementById('midiStatusIndicator');

    // Clear existing options
    while (midiOutputSelect.firstChild) {
        midiOutputSelect.removeChild(midiOutputSelect.firstChild);
    }

    // Add a default option "Select MIDI Output"
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.text = "Selecciona la salida MIDI...";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    midiOutputSelect.appendChild(defaultOption);

    // Add MIDI output options
    outputs.forEach(output => {
        if (output.state === 'connected') { // Only show connected devices
            const option = document.createElement('option');
            option.value = output.id;
            option.text = output.name;
            midiOutputSelect.appendChild(option);
        }
    });

    // Update MIDI status indicator
    if (outputs.length === 0) {
        console.error("No MIDI output devices found.");
        midiStatusIndicator.style.backgroundColor = 'red';
    } else {
        midiStatusIndicator.style.backgroundColor = 'green';
    }

    // Handle MIDI output selection
    midiOutputSelect.onchange = (e) => {
        const selectedId = e.target.value;
        midiOutput = midiAccess.outputs.get(selectedId);
        if (midiOutput) {
            console.log("MIDI connected: ", midiOutput.name);
            midiStatusIndicator.style.backgroundColor = 'green';
            pingMidiConnection();
        } else {
            console.log("No MIDI output selected");
            midiStatusIndicator.style.backgroundColor = 'red';
        }
    };
}


function onMIDIFailure(error) {
    console.error("Failed to access MIDI devices:", error);
    alert("Failed to access MIDI devices: " + error);
}

// Function to send a MIDI ping message
function pingMidiConnection() {
    if (midiOutput) {
        try {
            midiOutput.send([0xF8]);
            console.log("MIDI ping sent successfully.");
        } catch (error) {
            console.error("Error sending MIDI ping:", error);
            const midiStatusIndicator = document.getElementById('midiStatusIndicator');
            if (midiStatusIndicator) midiStatusIndicator.style.backgroundColor = 'red';
        }
    }
}


// Request MIDI access with proper permissions
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess({ sysex: false })
        .then(onMIDISuccess, onMIDIFailure)
        .catch(error => {
            console.error("navigator.requestMIDIAccess() error:", error);
        });
} else {
    console.error("Web MIDI API not supported in this browser.");
    alert("Web MIDI API not supported in this browser.");
}

// Setup function
function setup() {
    const canvas = createCanvas(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));
    canvas.parent('videoContainer');

    // Inicializar captura de video con p5.js
    let constraints = {
        video: {
            facingMode: 'user'
        },
        audio: false
    };

    video = createCapture(constraints, () => {
        console.log('Captura de video iniciada');
    });
    video.size(width, height);
    video.hide();

    // Inicializar FaceMesh
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

    // Comenzar a procesar los frames del video
    video.elt.onloadeddata = () => {
        processVideoFrame();
    };

    // Resto de tu código de configuración...
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
    setupWaveformSelect();

    // Event to close presentation mode
    const closePresentationButton = document.getElementById('closePresentationButton');
    if (closePresentationButton) {
        closePresentationButton.addEventListener('click', deactivatePresentationMode);
    }

    // Listen for "Escape" key to close presentation mode
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            deactivatePresentationMode();
        }
    });


// Initialize the sampler on page load
document.addEventListener("DOMContentLoaded", () => {
    initializeSampler();
    checkIfInstrumentLoaded();
});

// Instrument selection listener
const midiInstrumentSelect = document.getElementById("midiInstrumentSelect");
if (midiInstrumentSelect) {
    midiInstrumentSelect.addEventListener('change', () => {
        midiInstrument = midiInstrumentSelect.value;
        initializeSampler(); // Reinitialize sampler when instrument changes
        console.log(`Instrument ${midiInstrument} selected and sampler initialized.`);
    });
}
}

function processVideoFrame() {
    faceMesh.send({ image: video.elt }).then(() => {
        requestAnimationFrame(processVideoFrame);
    });
}

// Adjust size when changing orientation or screen size
function windowResized() {
    resizeCanvas(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));
    video.size(width, height);
}

// function setupCamera() {
//     const camera = new Camera(video.elt, {
//         onFrame: async () => {
//             await faceMesh.send({ image: video.elt });
//         },
//         width: video.width,
//         height: video.height,
//     });

//     camera.start().catch(error => {
//         console.error("Failed to start the camera:", error);
//         alert("Failed to start the camera: " + error.message);
//     });
// }


// Configure waveform selection
function setupWaveformSelect() {
    const waveformSelect = document.getElementById('waveformSelect');
    if (waveformSelect) {
        waveformSelect.addEventListener('change', () => {
            thereminWaveform = waveformSelect.value;
            console.log(`Waveform changed to: ${thereminWaveform}`);
        });
    }
}

// Configure gesture buttons
function setupGestureButtons() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];

    // Inicializar el estado de mute para los gestos
    gestures.forEach(gesture => {
        if (soloGestures[gesture]) {
            // Si el gesto está en solo, los demás gestos se mutearán
            gestures.forEach(g => {
                if (g !== gesture) {
                    muteGestures[g] = true;
                }
            });
        }
    });

    gestures.forEach(gesture => {
        // Mute button
        const muteButton = document.getElementById(`${gesture}Mute`);
        if (muteButton) {
            muteButton.addEventListener('click', () => {
                muteGestures[gesture] = !muteGestures[gesture];
                muteButton.classList.toggle('active', muteGestures[gesture]);
                console.log(`${gesture} ${muteGestures[gesture] ? 'muted' : 'unmuted'}`);
            });
            // Establecer el estado inicial del botón mute
            muteButton.classList.toggle('active', muteGestures[gesture]);
        }

        // Solo button
        const soloButton = document.getElementById(`${gesture}Solo`);
        if (soloButton) {
            soloButton.addEventListener('click', () => {
                soloGestures[gesture] = !soloGestures[gesture];
                soloButton.classList.toggle('active', soloGestures[gesture]);
                if (soloGestures[gesture]) {
                    // Si este gesto está en solo, mutear los demás gestos
                    gestures.forEach(g => {
                        if (g !== gesture) {
                            muteGestures[g] = true;
                            const muteBtn = document.getElementById(`${g}Mute`);
                            if (muteBtn) muteBtn.classList.add('active');
                        }
                    });
                } else {
                    // Si se desactiva el solo, desmutear los demás gestos
                    gestures.forEach(g => {
                        if (g !== gesture) {
                            muteGestures[g] = false;
                            const muteBtn = document.getElementById(`${g}Mute`);
                            if (muteBtn) muteBtn.classList.remove('active');
                        }
                    });
                }
                console.log(`${gesture} solo ${soloGestures[gesture] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón solo
            soloButton.classList.toggle('active', soloGestures[gesture]);
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
                console.log(`${gesture} control ${controlGestures[gesture] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón control
            controlButton.classList.toggle('active', controlGestures[gesture]);
            if (controlGestures[gesture] && ccDisplay) {
                ccDisplay.innerText = `CC${gestureCCNumbers[gesture]}`;
            }
        }

        // Notes button
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
                console.log(`${gesture} notes ${notasGestures[gesture] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón notas
            notasButton.classList.toggle('active', notasGestures[gesture]);
        }

        // Trigger button
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
                console.log(`${gesture} trigger ${disparadorGestures[gesture] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón disparador
            disparadorButton.classList.toggle('active', disparadorGestures[gesture]);
        }

        // Scaling button
        const scalingButton = document.getElementById(`${gesture}Scaling`);
        if (scalingButton) {
            scalingButton.addEventListener('click', () => {
                scalingGestures[gesture] = !scalingGestures[gesture];
                scalingButton.classList.toggle('active', scalingGestures[gesture]);
                console.log(`${gesture} scaling ${scalingGestures[gesture] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón scaling
            scalingButton.classList.toggle('active', scalingGestures[gesture]);
        }
    });

    // Configuración para los parámetros del envolvente: attack, decay, sustain, sustainDuration, release
    const envelopeParams = ['attack', 'decay', 'sustain', 'sustainDuration', 'release'];

    // Inicializar el estado de mute para los parámetros del envolvente
    envelopeParams.forEach(param => {
        if (soloGestures[param]) {
            // Si el parámetro está en solo, los demás parámetros se mutearán
            envelopeParams.forEach(p => {
                if (p !== param) {
                    muteGestures[p] = true;
                }
            });
        }
    });

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
            // Establecer el estado inicial del botón mute
            muteButton.classList.toggle('active', muteGestures[param]);
        }

        if (soloButton) {
            soloButton.addEventListener('click', () => {
                soloGestures[param] = !soloGestures[param];
                soloButton.classList.toggle('active', soloGestures[param]);
                if (soloGestures[param]) {
                    // Si este parámetro está en solo, mutear los demás parámetros
                    envelopeParams.forEach(p => {
                        if (p !== param) {
                            muteGestures[p] = true;
                            const muteBtn = document.getElementById(`${p}Mute`);
                            if (muteBtn) muteBtn.classList.add('active');
                        }
                    });
                } else {
                    // Si se desactiva el solo, desmutear los demás parámetros
                    envelopeParams.forEach(p => {
                        if (p !== param) {
                            muteGestures[p] = false;
                            const muteBtn = document.getElementById(`${p}Mute`);
                            if (muteBtn) muteBtn.classList.remove('active');
                        }
                    });
                }
                console.log(`${param} solo ${soloGestures[param] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón solo
            soloButton.classList.toggle('active', soloGestures[param]);
        }

        if (controlButton) {
            controlGestures[param] = controlGestures[param] || false; // Asegurar que existe
            controlButton.addEventListener('click', () => {
                controlGestures[param] = !controlGestures[param];
                controlButton.classList.toggle('active', controlGestures[param]);
                if (controlGestures[param] && ccDisplay) {
                    ccDisplay.innerText = `CC${gestureCCNumbers[param]}`;
                } else if (ccDisplay) {
                    ccDisplay.innerText = '';
                }
                console.log(`${param} control ${controlGestures[param] ? 'activated' : 'deactivated'}`);
            });
            // Establecer el estado inicial del botón control
            controlButton.classList.toggle('active', controlGestures[param]);
            if (controlGestures[param] && ccDisplay) {
                ccDisplay.innerText = `CC${gestureCCNumbers[param]}`;
            }
        }
    });
}

// Configure scaling inputs
function setupScalingInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const minInput = document.getElementById(`${gesture}Min`);
        const maxInput = document.getElementById(`${gesture}Max`);
        if (minInput) {
            minInput.addEventListener('change', () => {
                const value = parseFloat(minInput.value);
                if (!isNaN(value)) {
                    gestureRanges[gesture].min = value;
                }
            });
        }
        if (maxInput) {
            maxInput.addEventListener('change', () => {
                const value = parseFloat(maxInput.value);
                if (!isNaN(value)) {
                    gestureRanges[gesture].max = value;
                }
            });
        }
    });
}

// Configure minimum change inputs
function setupMinChangeInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const minChangeInput = document.getElementById(`${gesture}MinChange`);
        if (minChangeInput) {
            minChangeInput.addEventListener('change', () => {
                const value = parseFloat(minChangeInput.value);
                if (!isNaN(value)) {
                    gestureMinChanges[gesture] = value;
                }
            });
        }
    });
}

// Configure threshold inputs
function setupUmbralInputs() {
    const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
    gestures.forEach(gesture => {
        const umbralInput = document.getElementById(`${gesture}Umbral`);
        if (umbralInput) {
            umbralInput.addEventListener('change', () => {
                const value = parseFloat(umbralInput.value);
                if (!isNaN(value)) {
                    gestureUmbrales[gesture] = value;
                }
            });
        }
    });
}

// Configure scale selection
function setupScaleSelection() {
    const scaleSelect = document.getElementById('scaleSelect');

    // Set 'major' as the selected scale and ensure it displays correctly
    selectedScale = 'major';
    if (scaleSelect) scaleSelect.value = selectedScale;

    // Event listener to update `selectedScale` when the user changes it
    if (scaleSelect) {
        scaleSelect.addEventListener('change', () => {
            selectedScale = scaleSelect.value;
        });
    }
}

// Configure root note selection
function setupRootNoteSelection() {
    const rootNoteSelect = document.getElementById('rootNoteSelect');
    if (rootNoteSelect) {
        rootNoteSelect.addEventListener('change', () => {
            rootNote = rootNoteSelect.value;
        });
    }
}

// Configure mode controls
function setupModeControls() {
    const percussionToggle = document.getElementById('percussionToggle');
    const percussionOptions = document.getElementById('percussionOptions');
    const percussionModeSelect = document.getElementById('percussionModeSelect');

    if (percussionToggle) {
        percussionToggle.addEventListener('click', () => {
            isPercussionActive = !isPercussionActive;
            percussionToggle.classList.toggle('active', isPercussionActive);
            if (isPercussionActive) {
                if (percussionOptions) percussionOptions.classList.add('active');
                const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
                gestures.forEach(gesture => {
                    disparadorGestures[gesture] = true;
                    const disparadorButton = document.getElementById(`${gesture}Disparador`);
                    if (disparadorButton) disparadorButton.classList.add('active');
                });
                console.log('Percusión activada');
            } else {
                if (percussionOptions) percussionOptions.classList.remove('active');
                const gestures = ['mouthOpen', 'smile', 'leftWink', 'rightWink', 'noseX', 'noseY'];
                gestures.forEach(gesture => {
                    disparadorGestures[gesture] = false;
                    const disparadorButton = document.getElementById(`${gesture}Disparador`);
                    if (disparadorButton) disparadorButton.classList.remove('active');
                });
                console.log('Percusión desactivada');
            }
        });
    } else {
        console.error("percussionToggle element not found");
    }

    if (percussionModeSelect) {
        percussionModeSelect.addEventListener('change', () => {
            percussionMode = percussionModeSelect.value;
            console.log(`Modo Percusión: ${percussionMode}`);
        });
    }

    const thereminToggle = document.getElementById('thereminToggle');
    const thereminModeOptions = document.getElementById('thereminModeOptions');
    const thereminSynthOption = document.getElementById('thereminSynthOption');
    const thereminNotesOption = document.getElementById('thereminNotesOption');
    const thereminSynthOptions = document.getElementById('thereminSynthOptions');
    const thereminNotesOptions = document.getElementById('thereminNotesOptions');
    const midiInstrumentSelect = document.getElementById('midiInstrumentSelect');

    // Botones para Dinámica en Theremin Notas
    let dynamicsWithWinkButton;
    let dynamicsWithMouthButton;

    // Funciones auxiliares para activar modos
    function activateThereminNotesMode() {
        thereminOption = 'notas';
        if (thereminSynthOptions) thereminSynthOptions.style.display = 'none';
        if (thereminNotesOptions) thereminNotesOptions.style.display = 'block';
        notasGestures['mouthOpen'] = true;
        if (mouthOpenNotasButton) mouthOpenNotasButton.classList.add('active');

        // Detener el oscilador del theremin si está activo
        if (isThereminPlaying) {
            thereminOscillator.stop();
            isThereminPlaying = false;
        }

        // Mostrar botones de dinámica
        showDynamicsButtons();

        console.log('Opción Theremin Notas seleccionada');
    }

    function activateThereminSynthMode() {
        thereminOption = 'synth';
        if (thereminSynthOptions) thereminSynthOptions.style.display = 'block';
        if (thereminNotesOptions) thereminNotesOptions.style.display = 'none';
        notasGestures['mouthOpen'] = false;
        if (mouthOpenNotasButton) mouthOpenNotasButton.classList.remove('active');

        // Detener el sampler si está activo
        if (polySampler) {
            polySampler.releaseAll();
        }

        // Ocultar botones de dinámica
        hideDynamicsButtons();

        console.log('Opción Theremin Synth seleccionada');
    }

    // Función para mostrar los botones de dinámica
    function showDynamicsButtons() {
        // Crear o mostrar el botón dynamicsWithWinkButton
        if (!dynamicsWithWinkButton) {
            dynamicsWithWinkButton = document.createElement('button');
            dynamicsWithWinkButton.id = 'dynamicsWithWinkButton';
            dynamicsWithWinkButton.classList.add('toggle-button');
            // Asignar atributo data-i18n y texto traducido
            dynamicsWithWinkButton.setAttribute('data-i18n', 'dynamicsWithWink');
            dynamicsWithWinkButton.innerText = getNestedTranslation(translations[currentLanguage], 'dynamicsWithWink');
            if (thereminNotesOptions) thereminNotesOptions.appendChild(dynamicsWithWinkButton);

            // Aplicar traducciones
            applyTranslations(currentLanguage);

            dynamicsWithWinkButton.addEventListener('click', () => {
                dynamicsWithWink = !dynamicsWithWink;
                dynamicsWithWinkButton.classList.toggle('active', dynamicsWithWink);

                if (dynamicsWithWink) {
                    dynamicsWithMouth = false;
                    if (dynamicsWithMouthButton) dynamicsWithMouthButton.classList.remove('active');

                    // Desmutear los gestos leftWink y rightWink
                    muteGestures['leftWink'] = false;
                    muteGestures['rightWink'] = false;

                    // Desactivar el modo Notas de ambos gestos
                    notasGestures['leftWink'] = false;
                    notasGestures['rightWink'] = false;

                    // Actualizar los botones de mute para leftWink y rightWink
                    const leftWinkMuteButton = document.getElementById('leftWinkMute');
                    const rightWinkMuteButton = document.getElementById('rightWinkMute');
                    if (leftWinkMuteButton) leftWinkMuteButton.classList.remove('active');
                    if (rightWinkMuteButton) rightWinkMuteButton.classList.remove('active');

                    // Actualizar los botones de Notas para leftWink y rightWink
                    const leftWinkNotasButton = document.getElementById('leftWinkNotas');
                    const rightWinkNotasButton = document.getElementById('rightWinkNotas');
                    if (leftWinkNotasButton) leftWinkNotasButton.classList.remove('active');
                    if (rightWinkNotasButton) rightWinkNotasButton.classList.remove('active');

                    console.log(`Dinámica con Guiño activada, gestos leftWink y rightWink desmuteados y modo Notas desactivado.`);
                } else {
                    // Mutear los gestos leftWink y rightWink
                    muteGestures['leftWink'] = true;
                    muteGestures['rightWink'] = true;

                    // Activar el modo Notas de ambos gestos
                    notasGestures['leftWink'] = true;
                    notasGestures['rightWink'] = true;

                    // Actualizar los botones de mute para leftWink y rightWink
                    const leftWinkMuteButton = document.getElementById('leftWinkMute');
                    const rightWinkMuteButton = document.getElementById('rightWinkMute');
                    if (leftWinkMuteButton) leftWinkMuteButton.classList.add('active');
                    if (rightWinkMuteButton) rightWinkMuteButton.classList.add('active');

                    // Actualizar los botones de Notas para leftWink y rightWink
                    const leftWinkNotasButton = document.getElementById('leftWinkNotas');
                    const rightWinkNotasButton = document.getElementById('rightWinkNotas');
                    if (leftWinkNotasButton) leftWinkNotasButton.classList.add('active');
                    if (rightWinkNotasButton) rightWinkNotasButton.classList.add('active');

                    console.log(`Dinámica con Guiño desactivada, gestos leftWink y rightWink muteados y modo Notas activado.`);
                }

                console.log(`Dinámica con Guiño: ${dynamicsWithWink ? 'activada' : 'desactivada'}`);
            });
        } else {
            dynamicsWithWinkButton.style.display = 'inline-block';
        }

        // Crear o mostrar el botón dynamicsWithMouthButton
        if (!dynamicsWithMouthButton) {
            dynamicsWithMouthButton = document.createElement('button');
            dynamicsWithMouthButton.id = 'dynamicsWithMouthButton';
            dynamicsWithMouthButton.classList.add('toggle-button');
            // Asignar atributo data-i18n y texto traducido
            dynamicsWithMouthButton.setAttribute('data-i18n', 'dynamicsWithMouth');
            dynamicsWithMouthButton.innerText = getNestedTranslation(translations[currentLanguage], 'dynamicsWithMouth');
            if (thereminNotesOptions) thereminNotesOptions.appendChild(dynamicsWithMouthButton);

            // Aplicar traducciones
            applyTranslations(currentLanguage);

            dynamicsWithMouthButton.addEventListener('click', () => {
                dynamicsWithMouth = !dynamicsWithMouth;
                dynamicsWithMouthButton.classList.toggle('active', dynamicsWithMouth);

                if (dynamicsWithMouth) {
                    dynamicsWithWink = false;
                    if (dynamicsWithWinkButton) dynamicsWithWinkButton.classList.remove('active');

                    // Desmutear el gesto mouthOpen si estaba muteado
                    muteGestures['mouthOpen'] = false;
                    const mouthOpenMuteButton = document.getElementById('mouthOpenMute');
                    if (mouthOpenMuteButton) mouthOpenMuteButton.classList.remove('active');

                    // Desactivar el modo Notas del gesto mouthOpen
                    notasGestures['mouthOpen'] = false;
                    if (mouthOpenNotasButton) mouthOpenNotasButton.classList.remove('active');

                    console.log(`Dinámica con Boca activada, gesto mouthOpen desmuteado y modo Notas desactivado.`);
                } else {
                    // Mutear el gesto mouthOpen
                    muteGestures['mouthOpen'] = true;
                    const mouthOpenMuteButton = document.getElementById('mouthOpenMute');
                    if (mouthOpenMuteButton) mouthOpenMuteButton.classList.add('active');

                    // Reactivar el modo Notas del gesto mouthOpen
                    notasGestures['mouthOpen'] = true;
                    if (mouthOpenNotasButton) mouthOpenNotasButton.classList.add('active');

                    console.log(`Dinámica con Boca desactivada, gesto mouthOpen muteado y modo Notas activado.`);
                }

                console.log(`Dinámica con Boca: ${dynamicsWithMouth ? 'activada' : 'desactivada'}`);
            });
        } else {
            dynamicsWithMouthButton.style.display = 'inline-block';
        }
    }

    // Función para ocultar los botones de dinámica
    function hideDynamicsButtons() {
        if (dynamicsWithWinkButton) dynamicsWithWinkButton.style.display = 'none';
        if (dynamicsWithMouthButton) dynamicsWithMouthButton.style.display = 'none';
    }

    // Inicialización al cargar la página
    isThereminActive = true;
    thereminOption = 'notas'; // Seleccionar la opción Notas
    midiInstrument = 'piano'; // Seleccionar Piano como instrumento predeterminado

    if (thereminToggle) thereminToggle.classList.add('active');
    if (thereminModeOptions) thereminModeOptions.classList.add('active');
    if (thereminNotesOptions) thereminNotesOptions.style.display = 'block';
    if (thereminSynthOptions) thereminSynthOptions.style.display = 'none';

    // Asegurarse de que el radio button de Notas esté seleccionado
    if (thereminNotesOption) thereminNotesOption.checked = true;
    if (thereminSynthOption) thereminSynthOption.checked = false;

    // Actualizar el botón Notas del gesto mouthOpen
    notasGestures['mouthOpen'] = true;
    const mouthOpenNotasButton = document.getElementById('mouthOpenNotas');
    if (mouthOpenNotasButton) mouthOpenNotasButton.classList.add('active');

    // Configurar el instrumento MIDI seleccionado en el selector
    if (midiInstrumentSelect) midiInstrumentSelect.value = midiInstrument;

    // Llamar a initializeSampler para cargar el instrumento
    initializeSampler();

    // Mostrar los botones de dinámica
    showDynamicsButtons();

    // Listener para thereminToggle
    if (thereminToggle) {
        thereminToggle.addEventListener('click', () => {
            isThereminActive = !isThereminActive;
            thereminToggle.classList.toggle('active', isThereminActive);
            if (isThereminActive) {
                if (thereminModeOptions) thereminModeOptions.classList.add('active');
                console.log('Theremin activado');
                // Reanudar el contexto de audio si no está en ejecución
                if (Tone.context.state !== 'running') {
                    Tone.context.resume();
                }

                // Restaurar la opción seleccionada (Notas o Synth)
                if (thereminNotesOption && thereminNotesOption.checked) {
                    activateThereminNotesMode();
                } else if (thereminSynthOption && thereminSynthOption.checked) {
                    activateThereminSynthMode();
                }

            } else {
                if (thereminModeOptions) thereminModeOptions.classList.remove('active');
                thereminOption = '';
                if (isThereminPlaying) {
                    thereminOscillator.stop();
                    isThereminPlaying = false;
                }
                notasGestures['mouthOpen'] = false;
                if (mouthOpenNotasButton) mouthOpenNotasButton.classList.remove('active');

                // Ocultar botones de dinámica si estaban visibles
                hideDynamicsButtons();
            }
        });
    } else {
        console.error("thereminToggle element not found");
    }

    // Listener para thereminNotesOption
    if (thereminNotesOption) {
        thereminNotesOption.addEventListener('change', () => {
            if (thereminNotesOption.checked) {
                activateThereminNotesMode();
            }
        });
    } else {
        console.error("thereminNotesOption not found");
    }

    // Listener para thereminSynthOption
    if (thereminSynthOption) {
        thereminSynthOption.addEventListener('change', () => {
            if (thereminSynthOption.checked) {
                activateThereminSynthMode();
            }
        });
    } else {
        console.error("thereminSynthOption not found");
    }

    // Selección de instrumento MIDI
    if (midiInstrumentSelect) {
        midiInstrumentSelect.addEventListener('change', () => {
            midiInstrument = midiInstrumentSelect.value;

            // Reinicializar samplers con el nuevo instrumento
            initializeSampler();

            console.log(`Instrumento ${midiInstrument} configurado.`);
        });
    }
}


// Configure instruction button
function setupInstructionButton() {
    const instructionButton = document.getElementById('instructionButton');
    const instructionModal = document.getElementById('instructionModal');
    const closeModalButton = document.getElementById('closeModalButton');

    if (instructionButton) {
        instructionButton.addEventListener('click', () => {
            if (instructionModal) instructionModal.style.display = 'block';
        });
    }

    if (closeModalButton) {
        closeModalButton.addEventListener('click', () => {
            if (instructionModal) instructionModal.style.display = 'none';
        });
    }
}
// Configure Presentation Mode button
function setupPresentationModeButton() {
    const presentationModeButton = document.getElementById('presentationModeButton');
    const presentationOverlay = document.getElementById('presentationOverlay');
    const closePresentationButton = document.getElementById('closePresentationButton');

    if (presentationModeButton) {
        presentationModeButton.addEventListener('click', () => {
            activatePresentationMode();
        });
    }

    if (closePresentationButton) {
        closePresentationButton.addEventListener('click', () => {
            deactivatePresentationMode();
        });
    }

    // Listen for "Escape" key to exit presentation mode
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            deactivatePresentationMode();
        }
    });
}

function activatePresentationMode() {
    document.body.classList.add('presentation-active');
    const presentationOverlay = document.getElementById('presentationOverlay');
    const closePresentationButton = document.getElementById('closePresentationButton');
    if (presentationOverlay) presentationOverlay.style.display = 'block';
    if (closePresentationButton) closePresentationButton.style.display = 'block';

    // Hide buttons and controls in presentation mode
    document.querySelectorAll('.mode-controls, #instructionButton, .midi-status').forEach(element => {
        element.classList.add('hidden');
    });

    // Resize canvas and video to full screen
    resizeCanvas(windowWidth, windowHeight);
    video.size(windowWidth, windowHeight);
}

function deactivatePresentationMode() {
    // Remove presentation mode class
    document.body.classList.remove('presentation-active');

    // Restore canvas and video to original size
    resizeCanvas(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));
    video.size(windowWidth * 0.9, (windowWidth * 0.9) / (4 / 3));

    // Restore visibility of elements that were hidden
    document.querySelectorAll('.mode-controls, #instructionButton, .midi-status').forEach(element => {
        element.classList.remove('hidden');
    });

    // Hide presentation overlay
    const presentationOverlay = document.getElementById('presentationOverlay');
    const closePresentationButton = document.getElementById('closePresentationButton');
    if (presentationOverlay) presentationOverlay.style.display = 'none';
    if (closePresentationButton) closePresentationButton.style.display = 'none';
}



// En setupEnvelopeSliders()
function setupEnvelopeSliders() {
    const envelopeParams = ['attack', 'decay', 'sustain', 'sustainDuration', 'release'];

    envelopeParams.forEach(param => {
        const slider = document.getElementById(`${param}Slider`);
        const valueDisplay = document.getElementById(`${param}Value`);

        if (slider) {
            slider.addEventListener('input', (e) => {
                if (muteGestures[param]) return;
                if (soloGestures[param] && !isGestureSolo(param)) return;

                let value = parseFloat(e.target.value);

                // Actualizar la variable global correspondiente
                switch (param) {
                    case 'attack':
                        attack = value;
                        break;
                    case 'decay':
                        decay = value;
                        break;
                    case 'sustain':
                        sustain = value;
                        break;
                    case 'sustainDuration':
                        sustainDuration = value;
                        break;
                    case 'release':
                        release = value;
                        break;
                }

                // Actualizar valores mostrados
                if (param === 'sustain') {
                    valueDisplay.innerText = value.toFixed(2);
                } else {
                    valueDisplay.innerText = `${value} ms`;
                }

                // Actualizar el envolvente del polySampler
                if (polySampler && polySampler.envelope) {
                    polySampler.envelope.attack = attack / 1000;
                    polySampler.envelope.decay = decay / 1000;
                    polySampler.envelope.sustain = sustain;
                    polySampler.envelope.release = release / 1000;

                    // Actualizar el release del Sampler
                    polySampler.release = release / 1000;
                } else {
                    console.warn('polySampler or polySampler.envelope is undefined.');
                }

                // Actualizar el envolvente del theremin si es aplicable
                if (thereminEnvelope) {
                    thereminEnvelope.attack = attack / 1000;
                    thereminEnvelope.decay = decay / 1000;
                    thereminEnvelope.sustain = sustain;
                    thereminEnvelope.release = release / 1000;
                }

                // Enviar mensaje MIDI si el Control está activo para este parámetro
                if (controlGestures[param]) {
                    let midiValue;
                    if (param === 'sustain') {
                        midiValue = Math.round(value * 127); // 'sustain' es un valor entre 0 y 1
                    } else {
                        let maxValue = parseFloat(slider.getAttribute('max'));
                        if (isNaN(maxValue) || maxValue === 0) {
                            console.error(`Valor máximo inválido para ${param}: ${maxValue}`);
                            return;
                        }
                        midiValue = Math.round((value / maxValue) * 127);
                    }
                    console.log(`Enviando MIDI CC para ${param}: midiValue=${midiValue}, value=${value}`);
                    sendContinuousMIDI(param, midiValue);
                }
            });
        }
    });
}

// En la función playSynthNoteWithDynamics()
function playSynthNoteWithDynamics(midiNote) {
    const noteName = midiToNoteName(midiNote);
    const now = Tone.now();

    // Calcular la velocidad (velocity) basada en la dinámica
    let velocity = 0.7; // Velocidad máxima por defecto

    if (dynamicsWithWink) {
        const leftWinkValue = currentGestureValues['leftWink'] || 0;
        const rightWinkValue = currentGestureValues['rightWink'] || 0;
        const winkAverage = (leftWinkValue + rightWinkValue) / 2;
        velocity = calculateVelocity(winkAverage);
    } else if (dynamicsWithMouth) {
        const mouthValue = currentGestureValues['mouthOpen'] || 0;
        velocity = calculateVelocity(mouthValue);
    }

    // Iniciar la nota
    polySampler.triggerAttack(noteName, now, velocity);

    // Programar la liberación de la nota después de la duración total
    const noteDuration = (attack + decay + sustainDuration) / 1000; // Convertir ms a segundos
    polySampler.triggerRelease(noteName, now + noteDuration);

    console.log(`Reproduciendo ${noteName} con velocidad: ${velocity}, Duración: ${noteDuration} segundos`);
}





// Function to handle triggers
function handleGestureDisparador(gesture, currentValue, onDisparador) {
    let umbral = gestureUmbrales[gesture];
    let minChange = gestureMinChanges[gesture];
    let direction = gestureDisparadorDirections[gesture];
    let disparadorState = gestureDisparadorStates[gesture];
    let lastValue = disparadorState.lastValue;
    let currentTime = Date.now();

    if (percussionMode === 'automatico') {
        // Detect sudden changes
        if (lastValue !== null) {
            let change = Math.abs(currentValue - lastValue);
            if (change > minChange && currentTime - disparadorState.lastTriggerTime > 500) {
                onDisparador();
                disparadorState.lastTriggerTime = currentTime;
            }
        }
    } else if (percussionMode === 'umbral') {
        // Threshold Mode
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

    // Update lastValue
    disparadorState.lastValue = currentValue;
}

// Function to handle notes
function handleGestureNotas(gesture, currentValue) {
    let minChange = gestureMinChanges[gesture];
    let lastValue = gestureDisparadorStates[gesture].lastValue || 0;

    // Scale value if scaling is active
    let scaledValue = currentValue;
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        scaledValue = map(currentValue, min, max, 0, 127);
        scaledValue = constrain(scaledValue, 0, 127);
    }

    let noteIndex = Math.floor(scaledValue / minChange);
    let lastNoteIndex = Math.floor(lastValue / minChange);

    if (noteIndex !== lastNoteIndex) {
        if (gestureActiveNotes[gesture]) {
            sendMIDINoteOff(gestureActiveNotes[gesture]);
            gestureActiveNotes[gesture] = null;
        }
        let midiNote = quantizeToScale(scaledValue, gesture);
        if (midiNote !== null) {
            // Send MIDI message
            sendMIDINoteOn(midiNote);
            // Play sound in the browser if theremin "notas" is active
            if (isThereminActive && thereminOption === 'notas') {
                playSynthNoteWhenReady(midiNote);
            }
            gestureActiveNotes[gesture] = midiNote;
        }
    }

    gestureDisparadorStates[gesture].lastValue = scaledValue;
}

function sendMIDINoteOn(midiNote) {
    if (midiOutput) {
        // Check if 'sustainDuration' is muted or soloed
        if (muteGestures['sustainDuration']) return;
        if (soloGestures['sustainDuration'] && !isGestureSolo('sustainDuration')) return;

        midiOutput.send([0x90, midiNote, 127]);
        console.log(`MIDI Note On: ${midiNote}`);
        const durationMs = attack + decay + sustainDuration + release;


        // Send Note Off after the total duration
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


// Function to detect gestures
function detectGestures(landmarks) {
    processMouthOpen(landmarks);
    processSmile(landmarks);
    processLeftWink(landmarks);
    processRightWink(landmarks);
    processNoseX(landmarks);
    processNoseY(landmarks);
}

// Processing functions for each gesture
function processMouthOpen(landmarks) {
    const gesture = 'mouthOpen';
    if (muteGestures[gesture]) return;
    if (Object.values(soloGestures).includes(true) && !soloGestures[gesture]) return;

    const topLip = landmarks[13];
    const bottomLip = landmarks[14];
    let mouthOpenValue = dist(topLip.x * width, topLip.y * height, bottomLip.x * width, bottomLip.y * height);

    // Store raw value for scaling
    let rawValue = mouthOpenValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        mouthOpenValue = map(mouthOpenValue, min, max, 0, 127);
        mouthOpenValue = constrain(mouthOpenValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(mouthOpenValue));

    // Store current value
    currentGestureValues[gesture] = mouthOpenValue;

    // Theremin
    if (isThereminActive && thereminOption === 'synth') {
        updateThereminContinuous(mouthOpenValue);
    }

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, mouthOpenValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('C4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, mouthOpenValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = mouthOpenValue;
}

function processSmile(landmarks) {
    const gesture = 'smile';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const leftMouth = landmarks[61];
    const rightMouth = landmarks[291];
    let smileValue = dist(leftMouth.x * width, leftMouth.y * height, rightMouth.x * width, rightMouth.y * height);

    // Store raw value for scaling
    let rawValue = smileValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        smileValue = map(smileValue, min, max, 0, 127);
        smileValue = constrain(smileValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(smileValue));

    // Store current value
    currentGestureValues[gesture] = smileValue;

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, smileValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('D4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, smileValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = smileValue;
}

function processLeftWink(landmarks) {
    const gesture = 'leftWink';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const leftEyeTop = landmarks[159];
    const leftEyeBottom = landmarks[145];
    let leftWinkValue = dist(leftEyeTop.x * width, leftEyeTop.y * height, leftEyeBottom.x * width, leftEyeBottom.y * height);

    // Store raw value for scaling
    let rawValue = leftWinkValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        leftWinkValue = map(leftWinkValue, min, max, 0, 127);
        leftWinkValue = constrain(leftWinkValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(leftWinkValue));

    // Store current value
    currentGestureValues[gesture] = leftWinkValue;

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, leftWinkValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('E4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, leftWinkValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = leftWinkValue;
}

function processRightWink(landmarks) {
    const gesture = 'rightWink';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const rightEyeTop = landmarks[386];
    const rightEyeBottom = landmarks[374];
    let rightWinkValue = dist(rightEyeTop.x * width, rightEyeTop.y * height, rightEyeBottom.x * width, rightEyeBottom.y * height);

    // Store raw value for scaling
    let rawValue = rightWinkValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        rightWinkValue = map(rightWinkValue, min, max, 0, 127);
        rightWinkValue = constrain(rightWinkValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(rightWinkValue));

    // Store current value
    currentGestureValues[gesture] = rightWinkValue;

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, rightWinkValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('F4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, rightWinkValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = rightWinkValue;
}

function processNoseX(landmarks) {
    const gesture = 'noseX';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const nose = landmarks[1];
    let noseXValue = nose.x * width;

    // Store raw value for scaling
    let rawValue = noseXValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        noseXValue = map(noseXValue, min, max, 0, 127);
        noseXValue = constrain(noseXValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(noseXValue));

    // Store current value
    currentGestureValues[gesture] = noseXValue;

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, noseXValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('G4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, noseXValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = noseXValue;
}

function processNoseY(landmarks) {
    const gesture = 'noseY';
    if (muteGestures[gesture]) return;
    if (soloGestures[gesture] && !isGestureSolo(gesture)) return;

    const nose = landmarks[1];
    let noseYValue = nose.y * height;

    // Store raw value for scaling
    let rawValue = noseYValue;

    // Scale if active
    if (scalingGestures[gesture]) {
        const min = gestureRanges[gesture].min;
        const max = gestureRanges[gesture].max;
        noseYValue = map(noseYValue, min, max, 0, 127);
        noseYValue = constrain(noseYValue, 0, 127);
    }

    updateGestureValueDisplay(`${gesture}Value`, Math.round(noseYValue));

    // Store current value
    currentGestureValues[gesture] = noseYValue;

    // Percussion and Trigger
    if (disparadorGestures[gesture]) {
        handleGestureDisparador(gesture, noseYValue, () => {
            if (isPercussionActive) {
                playPercussionSound(gesture);
            } else {
                sendMIDINoteOn(noteNameToMidi('A4'));
            }
        });
    }

    // Notes
    if (notasGestures[gesture]) {
        handleGestureNotas(gesture, rawValue);
    }

    // Control
    if (controlGestures[gesture]) {
        sendContinuousMIDI(gesture, noseYValue);
    }

    // Update lastValue
    gestureDisparadorStates[gesture].lastValue = noseYValue;
}

// Function to check if a gesture is solo
function isGestureSolo(gestureOrParam) {
    return soloGestures[gestureOrParam] && Object.values(soloGestures).filter(v => v).length === 1;
}

// Function to update Theremin in synth mode
function updateThereminContinuous(mouthValue) {
    const frequency = map(mouthValue, 0, 127, 100, 1000); // Adjust frequency range
    const leftWinkValue = currentGestureValues['leftWink'] || 0;
    const rightWinkValue = currentGestureValues['rightWink'] || 0;
    const winkAverage = (leftWinkValue + rightWinkValue) / 2;

    // Calculate volume based on wink average
    let volume;
    let volumeDb;

    if (winkAverage < 10 || mouthValue === 0) {
        volume = 0; // Silence
        volumeDb = -Infinity;
    } else if (winkAverage >= 40) {
        volumeDb = -6; // Max volume (-6 dB)
        volume = Tone.dbToGain(volumeDb);
    } else {
        volumeDb = map(winkAverage, 10, 40, -40, -6); // Adjust volume range
        volume = Tone.dbToGain(volumeDb);
    }

    if (!isThereminPlaying) {
        thereminEnvelope = new Tone.AmplitudeEnvelope({
            attack: attack / 1000,
            decay: decay / 1000,
            sustain: sustain,
            release: release / 1000,
        }).toDestination();

        thereminOscillator = new Tone.Oscillator(frequency, thereminWaveform).connect(thereminEnvelope);
        thereminOscillator.start();
        isThereminPlaying = true;
    } else {
        thereminOscillator.frequency.value = frequency;
    }

    // Control the envelope
    if (volume > 0) {
        thereminEnvelope.triggerAttack();
    } else {
        thereminEnvelope.triggerRelease();
    }
}

// Function to play note when instrument is loaded
function playSynthNoteWhenReady(midiNote) {
    console.log(`Intentando reproducir nota ${midiNote}, isInstrumentLoaded: ${isInstrumentLoaded}`);
    if (!isInstrumentLoaded) {
        console.warn("Instrumento aún no cargado. Reintentando en 200ms.");
        setTimeout(() => playSynthNoteWhenReady(midiNote), 200);
        return;
    }
    playSynthNoteWithDynamics(midiNote);
}


// Track the next sampler to use
//let samplerIndex = 0;

// Function to play note with dynamics
function playSynthNoteWithDynamics(midiNote) {
    const noteName = midiToNoteName(midiNote);
    const now = Tone.now();

    // Calcular la velocidad (velocity) basada en la dinámica
    let velocity = 0.7; // Velocidad máxima por defecto

    if (dynamicsWithWink) {
        const leftWinkValue = currentGestureValues['leftWink'] || 0;
        const rightWinkValue = currentGestureValues['rightWink'] || 0;
        const winkAverage = (leftWinkValue + rightWinkValue) / 2;
        velocity = calculateVelocity(winkAverage);
    } else if (dynamicsWithMouth) {
        const mouthValue = currentGestureValues['mouthOpen'] || 0;
        velocity = calculateVelocity(mouthValue);
    }

    // Iniciar la nota
    polySampler.triggerAttack(noteName, now, velocity);

    // Programar la liberación de la nota después de la duración total
    const noteDuration = (attack + decay + sustainDuration) / 1000; // Convertir ms a segundos
    polySampler.triggerRelease(noteName, now + noteDuration);

    console.log(`Reproduciendo ${noteName} con velocidad: ${velocity}, Duración: ${noteDuration} segundos`);
}

// Function to calculate velocity
function calculateVelocity(value) {
    if (value < 10) {
        return 0; // Silence
    } else if (value >= 40) {
        return 1; // Max velocity
    } else {
        return map(value, 10, 40, 0, 1); // Map value to range 0-1 for dynamic control
    }
}

// Auxiliary functions
function sendContinuousMIDI(gestureOrParam, value) {
    const midiValue = Math.min(127, Math.max(0, Math.round(value)));
    const controlNumber = gestureCCNumbers[gestureOrParam];
    if (midiOutput && controlNumber !== undefined) {
        midiOutput.send([0xB0, controlNumber, midiValue]);
        console.log(`MIDI CC sent: ${gestureOrParam} Value ${midiValue}`);
    }
}

function quantizeToScale(value, gesture) {
    const minChange = gestureMinChanges[gesture];
    const scaleNotes = scales[selectedScale];
    const numNotes = scaleNotes.length;
    const rootMidi = noteNameToMidi(rootNote + '3'); // Base octave 3

    // Calculate index in the scale
    const index = Math.floor(value / minChange);

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
    mouthOpen: new Tone.Player("https://cdn.freesound.org/previews/587/587239_911455-lq.mp3").toDestination(), // Bass drum
    smile: new Tone.Player("https://cdn.freesound.org/previews/103/103365_1225281-lq.mp3").toDestination(),    // Snare
    leftWink: new Tone.Player("https://cdn.freesound.org/previews/669/669735_5819399-lq.mp3").toDestination(), // Low tom
    rightWink: new Tone.Player("https://cdn.freesound.org/previews/441/441645_4157918-lq.mp3").toDestination(),  // High tom
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
    const regex = /^([A-G]#?)(-?\d)$/;
    const match = noteName.match(regex);
    if (match) {
        const note = match[1];
        const octave = parseInt(match[2]);
        return (octave + 1) * 12 + noteMap[note];
    }
    return 60; // Default value if parsing fails
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
        currentLandmarks = smoothedLandmarks; // Save for use in draw()
        detectGestures(smoothedLandmarks);
    } else {
        currentLandmarks = null; // No landmarks
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

function draw() {
   
    blendMode(BLEND);
    background(0);
    // Dibuja el video en el lienzo
   // image(video, 0, 0, width, height);

    // Dibuja los landmarks si están disponibles
    if (currentLandmarks) {
        drawLandmarks(currentLandmarks);
    }
}

// Update the drawLandmarks function
function drawLandmarks(landmarks) {
    noStroke();
    fill(0, 255, 0); // Lime color

    for (let i = 0; i < landmarks.length; i++) {
        // Invert the x-coordinate to correct the direction
        const x = width - (landmarks[i].x * width);
        const y = landmarks[i].y * height;
        ellipse(x, y, 3, 3); // Draw a small circle at each landmark point
    }
}


// Function to verify if the instrument is loaded
function checkIfInstrumentLoaded() {
    if (isInstrumentLoaded) {
        console.log("Sampler cargado completamente.");
    } else {
        console.warn("Esperando que el sampler cargue. Reintentando en 100 ms.");
        setTimeout(checkIfInstrumentLoaded, 100);
    }
}
