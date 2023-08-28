let timeLeft = 60;
let timerInterval;
const timerDiv = document.getElementById('timer');
const startPauseBtn = document.getElementById('startPauseBtn');

// Audio setup
const audio1 = new Audio('sound_start.mp3');
const audio2 = new Audio('sound_10sec.mp3');

function updateDisplay() {
    timerDiv.textContent = timeLeft;

    if (timeLeft === 10) {
        audio2.currentTime = 0;
        audio2.play();
    }
}

function startTimer() {
    if (!timerInterval) {
        audio1.play();

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
    startPauseBtn.textContent = 'Start';
}
