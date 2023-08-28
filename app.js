let timeLeft = 60;
let timerInterval;
const timerDiv = document.getElementById('timer');
const startPauseBtn = document.getElementById('startPauseBtn');

// Audio setup
const audio1 = new Audio('sound_start.mp3');
const audio2 = new Audio('sound_10sec.mp3');

let justStarted = true;  // flag to determine if timer was freshly started

function updateDisplay() {
    timerDiv.textContent = timeLeft;
    updateCircle();

    if (timeLeft === 10) {
        audio2.currentTime = 0;
        audio2.play();
    }
}

function startTimer() {
    if (justStarted) {
        audio1.play();
        justStarted = false;
    }

    if (!timerInterval) {
        timerInterval = setInterval(() => {
            if (timeLeft > 0) {
                timeLeft--;
                updateDisplay();
            } else {
                stopAllSounds();
                clearInterval(timerInterval);
                timerInterval = null;
                startPauseBtn.textContent = 'Start';
            }
        }, 1000);
    }
}

function pauseTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;

        if (timeLeft <= 10) {
            audio2.pause();
        }
    }
}

function stopAllSounds() {
    audio1.pause();
    audio1.currentTime = 0;
    audio2.pause();
    audio2.currentTime = 0;
}

startPauseBtn.addEventListener('click', function() {
    if (timeLeft <= 0) {
        return;
    }

    if (startPauseBtn.textContent === 'Start') {
        if (timeLeft <= 10) {
            audio2.play();
        }
        startTimer();
        startPauseBtn.textContent = 'Pause';
    } else {
        pauseTimer();
        startPauseBtn.textContent = 'Start';
    }
});

function resetTimer(value) {
    pauseTimer();
    stopAllSounds();
    timeLeft = value;
    updateDisplay();
    updateCircle();
    startPauseBtn.textContent = 'Start';
    justStarted = true;
}

function updateCircle() {
    let percentage = timeLeft / 60; // adjust denominator based on maximum time
    let offset = 301 - 301 * percentage;
    document.querySelector('.circle-fg').style.strokeDashoffset = offset;
}
