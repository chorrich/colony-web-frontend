import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDsDnmTs6Npna0TWGbxdKh7i8lxvp1tkHo",
  authDomain: "the-colony-156be.firebaseapp.com",
  projectId: "the-colony-156be",
  storageBucket: "the-colony-156be.firebasestorage.app",
  messagingSenderId: "826905374250",
  appId: "1:826905374250:web:87eb39895d081b052d1d53",
  measurementId: "G-PGCPPWHJ50"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let equityChartInstance = null;
let lastUpdateStr = "";
let currentAccount = null;
let currentDashboardData = null;
let unsubscribeSnapshot = null;
let currentPerfYear = new Date().getFullYear();
let selectedCalendarMonth = new Date().getMonth(); // 0-11
let selectedCalendarYear = new Date().getFullYear();

// API Tracking Mechanics
let pingInterval = null;
let idleTimer = null;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    if (currentAccount) {
        idleTimer = setTimeout(() => {
            console.log("User idle for 10 minutes. Auto-logging out...");
            handleLogout();
        }, IDLE_TIMEOUT_MS);
    }
}

async function sendPing() {
    if (!currentAccount) return;
    try {
        await setDoc(doc(db, "active_sessions", currentAccount), {
            last_active: Date.now()
        }, { merge: true });
    } catch (e) {
        console.error("Failed to ping Firebase:", e);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Setup idle tracking
    document.addEventListener('mousemove', resetIdleTimer);
    document.addEventListener('keypress', resetIdleTimer);
    document.addEventListener('click', resetIdleTimer);
    document.addEventListener('scroll', resetIdleTimer);

    // Setup login button
    document.getElementById("btn-login").addEventListener("click", handleLogin);

    // Setup logout button
    document.getElementById("btn-logout").addEventListener("click", handleLogout);

    // Allow pressing Enter in input
    document.getElementById("mt5-account").addEventListener("keypress", function (e) {
        if (e.key === 'Enter') handleLogin();
    });

    document.getElementById("mt5-password").addEventListener("keypress", function (e) {
        if (e.key === 'Enter') handleLogin();
    });

    // Setup year nav
    document.getElementById("btn-prev-year").addEventListener("click", () => {
        currentPerfYear--;
        refreshYearlyGrid();
    });
    document.getElementById("btn-next-year").addEventListener("click", () => {
        currentPerfYear++;
        const maxYear = new Date().getFullYear();
        if (currentPerfYear > maxYear) currentPerfYear = maxYear;
        // Don't go into the future
        refreshYearlyGrid();
    });

    // Check for existing session
    checkSession();
});

async function checkSession() {
    const savedAccount = localStorage.getItem("colony_account");
    const savedPassword = localStorage.getItem("colony_password");

    if (savedAccount && savedPassword) {
        document.getElementById("mt5-account").value = savedAccount;
        document.getElementById("mt5-password").value = savedPassword;
        await handleLogin();
    }
}

function refreshYearlyGrid() {
    if (currentDashboardData) {
        updateYearlyPerformance(currentDashboardData.daily_pnl);
    }
}

async function handleLogout() {
    if (currentAccount) {
        try {
            await setDoc(doc(db, "active_sessions", currentAccount), {
                last_active: 0 // kill session
            }, { merge: true });
        } catch (e) {}
    }

    currentAccount = null;
    localStorage.removeItem("colony_account");
    localStorage.removeItem("colony_password");
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
    }
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    const userChip = document.getElementById("user-chip");
    if (userChip) {
        userChip.style.display = "none";
    }
    document.getElementById("mt5-account").value = "";
    document.getElementById("mt5-password").value = "";
    document.getElementById("dashboard-container").style.display = "none";
    document.getElementById("login-error").style.display = "none";
    document.getElementById("login-overlay").style.display = "flex";
}

async function handleLogin() {
    const accInput = document.getElementById("mt5-account").value.trim();
    const passInput = document.getElementById("mt5-password").value.trim();
    const errorEl = document.getElementById("login-error");
    const btn = document.getElementById("btn-login");

    if (!accInput || !passInput) {
        errorEl.innerText = "Please enter both MT5 no. and Password.";
        errorEl.style.display = "block";
        return;
    }

    errorEl.style.display = "none";
    btn.innerText = "Verifying...";
    btn.disabled = true;

    try {
        // Wake up backend first so it knows to fetch data for this account
        await setDoc(doc(db, "active_sessions", accInput), { last_active: Date.now() }, { merge: true });

        // Try to fetch the specific account data from Firestore
        let docSnap = await getDoc(doc(db, "portfolios", accInput));
        
        let retries = 0;
        while (!docSnap.exists() && retries < 8) {
            btn.innerText = `Syncing MT5 Data to Cloud (${retries + 1}/8)...`;
            await new Promise(r => setTimeout(r, 2000));
            docSnap = await getDoc(doc(db, "portfolios", accInput));
            retries++;
        }

        if (!docSnap.exists()) {
            throw new Error("Account data not found on Cloud. Please wait for sync.");
        }

        const data = docSnap.data();

        if (!data.account || data.account.auth_key !== passInput) {
             throw new Error("Invalid MT5 Password or account mismatch");
        }

        // Login Success
        currentAccount = accInput;
        // Save session
        localStorage.setItem("colony_account", accInput);
        localStorage.setItem("colony_password", passInput);

        // Update User Chip
        const userChip = document.getElementById("user-chip");
        const userChipText = document.getElementById("user-chip-text");
        if (userChip && userChipText) {
            userChipText.innerText = "xxxx" + accInput.slice(-4);
            userChip.style.display = "flex";
        }

        document.getElementById("login-overlay").style.display = "none";
        document.getElementById("dashboard-container").style.display = "block";

        // Initial update
        updateDashboard(data);
        lastUpdateStr = data.last_updated;

        // Start real-time Firestore subscription instead of HTTP polling!
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        unsubscribeSnapshot = onSnapshot(doc(db, "portfolios", accInput), (doc) => {
            if (doc.exists()) {
                const liveData = doc.data();
                if (liveData.last_updated !== lastUpdateStr) {
                    updateDashboard(liveData);
                    lastUpdateStr = liveData.last_updated;
                }
            } else {
                handleLogout(); // Deleted or banned
            }
        });

        // Start Tracking API Session
        if (pingInterval) clearInterval(pingInterval);
        sendPing(); // initial ping
        pingInterval = setInterval(sendPing, 30000); // ping every 30 seconds
        resetIdleTimer();

    } catch (error) {
        console.error("Login failed:", error);
        errorEl.innerText = error.message || "Account not found or inactive.";
        errorEl.style.display = "block";
    } finally {
        btn.innerText = "View Dashboard";
        btn.disabled = false;
    }
}

function updateDashboard(data) {
    currentDashboardData = data;

    // 1. Update Last Updated
    const lastUpdateEl = document.getElementById("val-last-update");
    if (lastUpdateEl) lastUpdateEl.innerText = data.last_updated.split(" ")[1]; // show time only

    // 2. Update KPI Cards
    const account = data.account;
    const perf = data.performance;

    document.getElementById("val-equity").innerText = formatCurrency(account.equity);
    document.getElementById("val-profit").innerText = (perf.net_profit >= 0 ? "+" : "") + formatCurrency(perf.net_profit);
    document.getElementById("val-winrate").innerText = perf.win_rate + "%";
    document.getElementById("val-total-trades").innerText = `From ${perf.total_trades} Total Trades`;

    // 3. Update HP Bar (Drawdown logic)
    // Assume HP is Balance. If Equity < Balance, we took damage.
    // If Equity >= Balance, HP is 100%, Damage is 0%
    let hpPercent = 100.0;
    let ddPercent = 0.0;

    if (account.balance > 0 && account.equity < account.balance) {
        ddPercent = ((account.balance - account.equity) / account.balance) * 100;
        hpPercent = 100 - ddPercent;
    }

    document.getElementById("val-hp-fill").style.width = `${hpPercent}%`;
    document.getElementById("val-hp-damage").style.width = `${ddPercent}%`;

    document.getElementById("val-hp-text").innerText = `Current HP: ${hpPercent.toFixed(1)}%`;
    document.getElementById("val-dd-text").innerText = `Damage (DD): -${ddPercent.toFixed(1)}%`;

    // 4. Update Margin Section
    document.getElementById("val-margin-used").innerText = formatCurrency(account.margin_used);
    document.getElementById("val-free-margin").innerText = formatCurrency(account.free_margin);

    let marginProgress = 0;
    if (account.equity > 0) {
        marginProgress = (account.margin_used / account.equity) * 100;
    }
    document.getElementById("val-margin-fill").style.width = `${Math.min(marginProgress, 100)}%`;

    // 5. Update Exposure List
    updateExposureList(data.exposure);

    // 6. Update Chart, Calendar, and Yearly Performance
    updateChart(data.daily_pnl, account.equity);
    updateCalendar(data.daily_pnl);
    updateYearlyPerformance(data.daily_pnl);
}

function updateYearlyPerformance(dailyPnlDict) {
    const yearLabel = document.getElementById("perf-year-label");
    if (yearLabel) yearLabel.innerText = currentPerfYear;

    const grid = document.getElementById("yearly-performance-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const currentDate = new Date();
    const isCurrentYear = currentPerfYear === currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();

    let monthlySums = new Array(12).fill(0);

    Object.keys(dailyPnlDict).forEach(dateStr => {
        if (dateStr.startsWith(currentPerfYear.toString())) {
            const monthStr = dateStr.split("-")[1];
            const monthIdx = parseInt(monthStr, 10) - 1;
            monthlySums[monthIdx] += dailyPnlDict[dateStr];
        }
    });

    const baseBalance = currentDashboardData && currentDashboardData.account.balance > 0
        ? currentDashboardData.account.balance
        : 1;

    for (let i = 0; i < 12; i++) {
        const div = document.createElement("div");
        div.style.cursor = "pointer"; // Make it clickable

        // Add click listener to change the calendar below
        div.addEventListener('click', () => {
            selectedCalendarMonth = i;
            selectedCalendarYear = currentPerfYear;
            updateCalendar(currentDashboardData.daily_pnl);
            refreshYearlyGrid(); // Re-render to highlight active month
        });

        let pnl = monthlySums[i];
        let pct = (pnl / baseBalance) * 100;

        // Visual Active State (If it matches the currently selected calendar month)
        const isSelectedCalMonth = (i === selectedCalendarMonth && currentPerfYear === selectedCalendarYear);

        // If we are looking at the current year and the month is in the future
        if (isCurrentYear && i > currentMonth) {
            div.className = "month-box empty";
            div.style.cursor = "default"; // Not clickable
            div.innerHTML = `<span class="m-label">${monthNames[i]}</span><span>--</span>`;
            // Remove click listener for empty future months
            const clone = div.cloneNode(true);
            grid.appendChild(clone);
            continue;
        } else {
            let classStr = "month-box";
            if (isSelectedCalMonth) {
                classStr += " active-month";
            }

            if (pnl > 0) {
                div.className = classStr;
                div.innerHTML = `<span class="m-label">${monthNames[i]}</span><span class="pos">+${pct.toFixed(2)}%</span>`;
            } else if (pnl < 0) {
                div.className = classStr;
                div.innerHTML = `<span class="m-label">${monthNames[i]}</span><span class="neg">${pct.toFixed(2)}%</span>`;
            } else {
                div.className = classStr + " empty";
                div.innerHTML = `<span class="m-label">${monthNames[i]}</span><span>0.0%</span>`;
            }
        }
        grid.appendChild(div);
    }
}

function updateExposureList(exposures) {
    const container = document.getElementById("exposure-list");
    container.innerHTML = "";

    // Find absolute max volume to scale bars properly
    let maxVol = 0;
    exposures.forEach(pos => {
        if (pos.volume > maxVol) maxVol = pos.volume;
    });

    if (exposures.length === 0) {
        container.innerHTML = `<div style="padding: 1rem; color: var(--text-dark); text-align: center;">No active positions</div>`;
        return;
    }

    exposures.forEach(pos => {
        const item = document.createElement("div");
        item.className = "exposure-item";

        const typeClass = pos.type.toLowerCase() === "buy" ? "buy" : "sell";
        const barClass = typeClass + "-bar";

        let widthPercent = maxVol > 0 ? (pos.volume / maxVol) * 100 : 0;

        item.innerHTML = `
            <div class="exposure-info">
                <span class="symbol">${pos.symbol}</span>
                <span class="type ${typeClass}">${pos.type}</span>
            </div>
            <div class="exposure-bar-container">
                <div class="exposure-bar ${barClass}" style="width: ${widthPercent}%;"></div>
            </div>
            <div class="exposure-value">${pos.volume} Lots</div>
        `;

        container.appendChild(item);
    });
}

function updateChart(dailyPnlDict, currentEquity) {
    // Construct cumulative equity curve
    // Assuming starting point was Current Equity - sum(all Pnl)
    let totalPnl = 0;
    const sortedDates = Object.keys(dailyPnlDict).sort();

    sortedDates.forEach(date => {
        totalPnl += dailyPnlDict[date];
    });

    let runningEquity = currentEquity - totalPnl;

    const labels = ["Start"];
    const dataPoints = [runningEquity];

    sortedDates.forEach(date => {
        labels.push(date);
        runningEquity += dailyPnlDict[date];
        dataPoints.push(runningEquity);
    });

    const ctx = document.getElementById('equityChart').getContext('2d');

    if (equityChartInstance) {
        equityChartInstance.data.labels = labels;
        equityChartInstance.data.datasets[0].data = dataPoints;
        equityChartInstance.update();
        return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Equity ($)',
                data: dataPoints,
                borderColor: '#3B82F6',
                backgroundColor: gradient,
                borderWidth: 3,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointBackgroundColor: '#0A0E17',
                pointBorderColor: '#3B82F6',
                pointBorderWidth: 2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(18, 24, 38, 0.9)',
                    titleColor: '#F8FAFC',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            let value = context.parsed.y;
                            return formatCurrency(value);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#94A3B8', maxTicksLimit: 6 }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    border: { dash: [5, 5] },
                    ticks: {
                        color: '#94A3B8',
                        callback: function (value) {
                            return '$' + (value / 1000).toFixed(1) + 'k';
                        }
                    }
                }
            }
        }
    };

    equityChartInstance = new Chart(ctx, config);
}

function updateCalendar(dailyPnlDict) {
    const calendarGrid = document.getElementById('calendarGrid');
    if (!calendarGrid) return;

    calendarGrid.innerHTML = "";

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthLabelEl = document.getElementById("val-calendar-month");

    // Use the selected globally tracked state
    const displayYear = selectedCalendarYear;
    const displayMonthIndex = selectedCalendarMonth;

    if (monthLabelEl) monthLabelEl.innerText = `${monthNames[displayMonthIndex]} ${displayYear}`;

    // Calculate days in month and starting day
    const daysInMonth = new Date(displayYear, displayMonthIndex + 1, 0).getDate();
    const firstDayOfMonth = new Date(displayYear, displayMonthIndex, 1).getDay();

    // JS getDay() starts with Sunday=0. We want Monday=0.
    let emptyDaysPrevMonth = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

    const currentMonthStr = String(displayMonthIndex + 1).padStart(2, '0');
    const prefix = `${displayYear}-${currentMonthStr}-`;

    // Add empty padding for prev month
    for (let i = 0; i < emptyDaysPrevMonth; i++) {
        const div = document.createElement('div');
        div.className = 'cal-day empty';
        calendarGrid.appendChild(div);
    }

    let monthlyPnl = 0;

    // Add actual days
    for (let i = 1; i <= daysInMonth; i++) {
        const dayOfWeek = (i + emptyDaysPrevMonth - 1) % 7;
        const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // 5=Sat, 6=Sun

        const div = document.createElement('div');

        if (isWeekend) {
            div.className = 'cal-day empty';
            div.innerHTML = `<span class="d-num">${i}</span>`;
            calendarGrid.appendChild(div);
            continue;
        }

        const dateKey = prefix + String(i).padStart(2, '0');
        let pnl = dailyPnlDict[dateKey] || 0;
        monthlyPnl += pnl;

        if (pnl > 0) {
            div.className = 'cal-day profit';
            div.innerHTML = `<span class="d-num">${i}</span><span class="d-val">+$${pnl.toFixed(0)}</span>`;
        } else if (pnl < 0) {
            div.className = 'cal-day loss';
            div.innerHTML = `<span class="d-num">${i}</span><span class="d-val">-$${Math.abs(pnl).toFixed(0)}</span>`;
        } else {
            // No trades that day
            div.className = 'cal-day empty';
            div.innerHTML = `<span class="d-num">${i}</span>`;
        }

        calendarGrid.appendChild(div);
    }

    // Update the Monthly P&L Pill
    const monthlyPnlEl = document.getElementById("val-monthly-pnl");
    if (monthlyPnlEl && currentDashboardData) {
        let baseBalance = currentDashboardData.account.balance > 0 ? currentDashboardData.account.balance : 1;
        let pct = (monthlyPnl / baseBalance) * 100;
        let shortMonth = monthNames[displayMonthIndex].substring(0, 3);
        
        // Strip out the old string and assign new style formats
        monthlyPnlEl.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
        monthlyPnlEl.style.border = "1px solid var(--border-color)";
        monthlyPnlEl.style.padding = "6px 12px";
        monthlyPnlEl.style.borderRadius = "20px";
        
        if (monthlyPnl >= 0) {
            monthlyPnlEl.style.color = "var(--accent-emerald)";
            monthlyPnlEl.innerText = `${shortMonth} P&L: +$${monthlyPnl.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})} (+${pct.toFixed(2)}%)`;
        } else {
            monthlyPnlEl.style.color = "var(--accent-rose)";
            monthlyPnlEl.innerText = `${shortMonth} P&L: -$${Math.abs(monthlyPnl).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})} (${pct.toFixed(2)}%)`;
        }
    }
}

// Helper 
function formatCurrency(num) {
    return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
