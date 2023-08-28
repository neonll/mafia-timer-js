let timeLeft = 60;
let timerInterval;
const timerDiv = document.getElementById('timer');
const startPauseBtn = document.getElementById('startPauseBtn');

function updateDisplay() {
    timerDiv.textContent = timeLeft;
}

function startTimer() {
    if (!timerInterval) {
        timerInterval = setInterval(() => {
            if (timeLeft > 0) {
                timeLeft--;
                updateDisplay();
            } else {
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
    }
}

startPauseBtn.addEventListener('click', function() {
    if (timeLeft <= 0) {
        return;
    }

    if (startPauseBtn.textContent === 'Start') {
        startTimer();
        startPauseBtn.textContent = 'Pause';
    } else {
        pauseTimer();
        startPauseBtn.textContent = 'Start';
    }
});

function resetTimer(value) {
    pauseTimer();
    timeLeft = value;
    updateDisplay();
    startPauseBtn.textContent = 'Start';
}
