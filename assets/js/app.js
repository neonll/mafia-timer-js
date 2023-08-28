let timeLeft = 60;
let timerInterval;
const timerDiv = document.getElementById('timer');
const startPauseBtn = document.getElementById('startPauseBtn');

// Audio setup
const audio1 = new Audio('/assets/sound/sound_start.mp3');
const audio2 = new Audio('/assets/sound/sound_10sec.mp3');

const btnPlay = '<i class="fa-solid fa-play"></i>';
const btnPause = '<i class="fa-solid fa-pause"></i>';
const btnReset60 = '<i class="fa-solid fa-shield"></i>';
const btnReset30 = '<i class="fa-solid fa-shield-halved"></i>';

let justStarted = true;  // flag to determine if timer was freshly started

function updateDisplay() {
    timerDiv.textContent = timeLeft;
    updateCircle();

    // Change the style if there are 10 seconds or less
    if (timeLeft <= 10) {
        document.querySelector('.circle').classList.add('circle-red');
    } else {
        document.querySelector('.circle').classList.remove('circle-red');
    }

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
                startPauseBtn.innerHTML = btnPlay;
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

    if (startPauseBtn.innerHTML === btnPlay) {
        if (timeLeft <= 10) {
            audio2.play();
        }
        startTimer();
        startPauseBtn.innerHTML = btnPause;
    } else {
        pauseTimer();
        startPauseBtn.innerHTML = btnPlay;
    }
});

function resetTimer(value) {
    pauseTimer();
    stopAllSounds();
    timeLeft = value;
    updateDisplay();
    updateCircle();
    startPauseBtn.innerHTML = btnPlay;
    justStarted = true;
    
    document.querySelector('.circle').classList.remove('circle-red');
}

function updateCircle() {
    let percentage = timeLeft / 60; // adjust denominator based on maximum time
    let offset = 301 - 301 * percentage;
    document.querySelector('.circle-fg').style.strokeDashoffset = offset;
}
