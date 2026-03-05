// ==============================
// Student Life Dashboard - Final
// Features:
// - Name gate + greeting
// - Tasks (due + priority) + sort + hide completed
// - Schedule list
// - Weekly calendar view (dblclick to add, click event to delete)
// - Grades + chart (home + grades)
// - Notes autosave
// - Creator page
// - Reminders toggle (uses browser notifications)
// ==============================

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function load(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}
function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}
function pad2(n){ return String(n).padStart(2,"0"); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function startOfWeek(d){
    const copy = new Date(d);
    const day = copy.getDay(); // 0 Sun
    const diff = (day === 0 ? -6 : 1) - day; // Monday start
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0,0,0,0);
    return copy;
}
function clampName(s){ return (s || "").trim().slice(0,24); }

function formatDateTime(dateStr, timeStr) {
    const d = new Date(`${dateStr}T${timeStr}`);
    return d.toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
}

// ---------- state ----------
let tasks = load("sl_tasks", []);
let schedule = load("sl_schedule", []);
let grades = load("sl_grades", []);
let notes = localStorage.getItem("sl_notes") || "";
let studentName = localStorage.getItem("sl_name") || "";
let notificationsEnabled = localStorage.getItem("sl_notify") === "true";
let reminderTimers = [];

// ---------- name gate ----------
const nameGate = $("#nameGate");
const appRoot = $("#appRoot");
const greeting = $("#greeting");

function showGateIfNeeded(){
    if (!studentName) {
        if (nameGate) nameGate.classList.remove("hidden");
        if (appRoot) appRoot.classList.add("hidden");
    } else {
        if (nameGate) nameGate.classList.add("hidden");
        if (appRoot) appRoot.classList.remove("hidden");
        if (greeting) greeting.textContent = `Hey ${studentName} 👋 Welcome to your dashboard.`;
    }
}

const nameForm = $("#nameForm");
if (nameForm) {
    nameForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("#studentNameInput");
        const name = clampName(input ? input.value : "");
        if (!name) return;
        studentName = name;
        localStorage.setItem("sl_name", studentName);
        showGateIfNeeded();
    });
}

showGateIfNeeded();

// ---------- nav / views ----------
const viewMap = {
    home: "#view-home",
    tasks: "#view-tasks",
    schedule: "#view-schedule",
    calendar: "#view-calendar",
    grades: "#view-grades",
    notes: "#view-notes",
    creator: "#view-creator",
};

function setView(name) {
    const pageTitle = $("#pageTitle");
    if (pageTitle) pageTitle.textContent = name[0].toUpperCase() + name.slice(1);

    $$(".view").forEach(v => v.classList.add("hidden"));
    const view = viewMap[name];
    if (view && $(view)) $(view).classList.remove("hidden");

    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    const btn = $(`.nav-btn[data-view="${name}"]`);
    if (btn) btn.classList.add("active");

    if (name === "calendar") renderWeek();
    if (name === "grades") drawGradeCharts();
}

$$(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
});

// top date
const todayEl = $("#today");
if (todayEl) {
    todayEl.textContent = new Date().toLocaleDateString([], { weekday:"long", month:"long", day:"numeric" });
}

// ---------- notifications ----------
const enableNotifications = $("#enableNotifications");
if (enableNotifications) enableNotifications.checked = notificationsEnabled;

async function requestNotifications() {
    if (!("Notification" in window)) {
        alert("This browser doesn't support notifications.");
        return false;
    }
    if (Notification.permission === "granted") return true;
    const result = await Notification.requestPermission();
    return result === "granted";
}

function notify(title, body) {
    if (!notificationsEnabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try { new Notification(title, { body }); } catch {}
}

function clearAllReminderTimers() {
    for (const id of reminderTimers) clearTimeout(id);
    reminderTimers = [];
}

function scheduleReminderAt(dt, title) {
    const ms = dt.getTime() - Date.now();
    if (ms <= 0) return;

    // only schedule within next 7 days
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (ms > sevenDays) return;

    const id = setTimeout(() => notify("Reminder", title), ms);
    reminderTimers.push(id);
}

function scheduleAllReminders() {
    clearAllReminderTimers();
    if (!notificationsEnabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    // schedule events: 10 min before
    for (const ev of schedule) {
        const dt = new Date(`${ev.date}T${ev.time}`);
        const remindAt = new Date(dt.getTime() - 10 * 60 * 1000);
        scheduleReminderAt(remindAt, `${ev.title} in 10 minutes`);
    }

    // tasks due: 8am
    for (const t of tasks) {
        if (!t.due || t.done) continue;
        const dt = new Date(`${t.due}T08:00`);
        scheduleReminderAt(dt, `Task due today: ${t.text}`);
    }
}

if (enableNotifications) {
    enableNotifications.addEventListener("change", async () => {
        if (enableNotifications.checked) {
            const ok = await requestNotifications();
            notificationsEnabled = ok;
            enableNotifications.checked = ok;
            localStorage.setItem("sl_notify", String(ok));
            if (ok) scheduleAllReminders();
        } else {
            notificationsEnabled = false;
            localStorage.setItem("sl_notify", "false");
            clearAllReminderTimers();
        }
    });
}

// ---------- tasks ----------
const taskList = $("#taskList");
const taskEmpty = $("#taskEmpty");
const hideCompleted = $("#hideCompleted");

function priorityScore(p){
    if (p === "high") return 3;
    if (p === "med") return 2;
    return 1;
}

function taskSort(a,b){
    const ad = a.due ? new Date(a.due).getTime() : Number.POSITIVE_INFINITY;
    const bd = b.due ? new Date(b.due).getTime() : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;

    const ap = priorityScore(a.priority);
    const bp = priorityScore(b.priority);
    if (ap !== bp) return bp - ap;

    return (b.createdAt || 0) - (a.createdAt || 0);
}

function renderTasks() {
    if (!taskList) return;
    taskList.innerHTML = "";

    const filtered = (hideCompleted && hideCompleted.checked) ? tasks.filter(t => !t.done) : tasks;
    if (taskEmpty) taskEmpty.style.display = filtered.length ? "none" : "block";

    filtered.forEach((t) => {
        const dueLabel = t.due ? new Date(t.due).toLocaleDateString() : "—";
        const pr = (t.priority || "med").toUpperCase();

        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = `
      <div class="left">
        <input type="checkbox" ${t.done ? "checked" : ""} aria-label="done"/>
        <div class="text" title="${t.text}">
          <strong>${t.text}</strong>
          <span class="muted"> • Due: ${dueLabel} • Priority: ${pr}</span>
        </div>
      </div>
      <div class="row">
        <button class="ghost remind-btn" title="Remind me in 10 minutes">Remind</button>
        <button class="ghost del-btn" aria-label="delete">Delete</button>
      </div>
    `;

        const checkbox = li.querySelector('input[type="checkbox"]');
        checkbox.addEventListener("change", () => {
            t.done = checkbox.checked;
            save("sl_tasks", tasks);
            renderTasks();
            renderHome();
            if (notificationsEnabled) scheduleAllReminders();
        });

        li.querySelector(".del-btn").addEventListener("click", () => {
            tasks = tasks.filter(x => x.id !== t.id);
            save("sl_tasks", tasks);
            renderTasks();
            renderHome();
            if (notificationsEnabled) scheduleAllReminders();
        });

        li.querySelector(".remind-btn").addEventListener("click", async () => {
            if (!notificationsEnabled) {
                alert("Turn on Reminders (top right) first.");
                return;
            }
            const ok = await requestNotifications();
            if (!ok) {
                alert("Notifications permission not granted.");
                return;
            }
            notificationsEnabled = true;
            if (enableNotifications) enableNotifications.checked = true;
            localStorage.setItem("sl_notify", "true");

            const dt = new Date(Date.now() + 10 * 60 * 1000);
            scheduleReminderAt(dt, `Task: ${t.text}`);
            alert("Okay — I’ll remind you in 10 minutes (keep this tab/browser open).");
        });

        if (t.done) li.style.opacity = "0.7";
        taskList.appendChild(li);
    });
}

const taskForm = $("#taskForm");
if (taskForm) {
    taskForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = ($("#taskInput")?.value || "").trim();
        if (!text) return;

        const due = $("#taskDue")?.value || null;
        const priority = $("#taskPriority")?.value || "med";

        tasks.unshift({
            id: crypto.randomUUID(),
            text,
            done: false,
            due,
            priority,
            createdAt: Date.now()
        });

        save("sl_tasks", tasks);

        $("#taskInput").value = "";
        if ($("#taskDue")) $("#taskDue").value = "";
        if ($("#taskPriority")) $("#taskPriority").value = "med";

        renderTasks();
        renderHome();
        if (notificationsEnabled) scheduleAllReminders();
    });
}

const quickTaskForm = $("#quickTaskForm");
if (quickTaskForm) {
    quickTaskForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = ($("#quickTaskInput")?.value || "").trim();
        if (!text) return;

        const due = $("#quickTaskDue")?.value || null;
        const priority = $("#quickTaskPriority")?.value || "med";

        tasks.unshift({
            id: crypto.randomUUID(),
            text,
            done: false,
            due,
            priority,
            createdAt: Date.now()
        });

        save("sl_tasks", tasks);

        $("#quickTaskInput").value = "";
        if ($("#quickTaskDue")) $("#quickTaskDue").value = "";
        if ($("#quickTaskPriority")) $("#quickTaskPriority").value = "med";

        renderTasks();
        renderHome();
        if (notificationsEnabled) scheduleAllReminders();
    });
}

if (hideCompleted) hideCompleted.addEventListener("change", renderTasks);

const clearCompleted = $("#clearCompleted");
if (clearCompleted) {
    clearCompleted.addEventListener("click", () => {
        tasks = tasks.filter(t => !t.done);
        save("sl_tasks", tasks);
        renderTasks();
        renderHome();
        if (notificationsEnabled) scheduleAllReminders();
    });
}

const sortTasksBtn = $("#sortTasks");
if (sortTasksBtn) {
    sortTasksBtn.addEventListener("click", () => {
        tasks.sort(taskSort);
        save("sl_tasks", tasks);
        renderTasks();
    });
}

// ---------- schedule ----------
const scheduleList = $("#scheduleList");
const scheduleEmpty = $("#scheduleEmpty");

function sortSchedule() {
    schedule.sort((a, b) => new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time));
}

function renderSchedule() {
    if (!scheduleList) return;
    sortSchedule();

    scheduleList.innerHTML = "";
    if (scheduleEmpty) scheduleEmpty.style.display = schedule.length ? "none" : "block";

    schedule.forEach((ev) => {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = `
      <div class="left">
        <div class="text" title="${ev.title}">
          <strong>${ev.title}</strong> • ${formatDateTime(ev.date, ev.time)}
        </div>
      </div>
      <div class="row">
        <button class="ghost remind-btn" title="Remind me 10 minutes before">Remind</button>
        <button class="ghost del-btn">Delete</button>
      </div>
    `;

        li.querySelector(".del-btn").addEventListener("click", () => {
            schedule = schedule.filter(x => x.id !== ev.id);
            save("sl_schedule", schedule);
            renderSchedule();
            renderHome();
            renderWeek();
            if (notificationsEnabled) scheduleAllReminders();
        });

        li.querySelector(".remind-btn").addEventListener("click", async () => {
            if (!notificationsEnabled) {
                alert("Turn on Reminders (top right) first.");
                return;
            }
            const ok = await requestNotifications();
            if (!ok) {
                alert("Notifications permission not granted.");
                return;
            }
            notificationsEnabled = true;
            if (enableNotifications) enableNotifications.checked = true;
            localStorage.setItem("sl_notify", "true");

            const dt = new Date(`${ev.date}T${ev.time}`);
            const remindAt = new Date(dt.getTime() - 10 * 60 * 1000);
            scheduleReminderAt(remindAt, `${ev.title} in 10 minutes`);
            alert("Reminder set (10 minutes before).");
        });

        scheduleList.appendChild(li);
    });
}

const scheduleForm = $("#scheduleForm");
if (scheduleForm) {
    scheduleForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = ($("#eventTitle")?.value || "").trim();
        const date = $("#eventDate")?.value;
        const time = $("#eventTime")?.value;
        if (!title || !date || !time) return;

        schedule.push({ id: crypto.randomUUID(), title, date, time });
        save("sl_schedule", schedule);

        $("#eventTitle").value = "";
        $("#eventDate").value = "";
        $("#eventTime").value = "";

        renderSchedule();
        renderHome();
        renderWeek();
        if (notificationsEnabled) scheduleAllReminders();
    });
}

// ---------- calendar (week view) ----------
let weekStart = startOfWeek(new Date());
const weekLabel = $("#weekLabel");
const weekGrid = $("#weekGrid");

const weekPrev = $("#weekPrev");
const weekNext = $("#weekNext");

if (weekPrev) {
    weekPrev.addEventListener("click", () => {
        weekStart.setDate(weekStart.getDate() - 7);
        renderWeek();
    });
}
if (weekNext) {
    weekNext.addEventListener("click", () => {
        weekStart.setDate(weekStart.getDate() + 7);
        renderWeek();
    });
}

function eventsOnDate(dateStr) {
    return schedule
        .filter(ev => ev.date === dateStr)
        .sort((a,b) => (a.time || "").localeCompare(b.time || ""));
}

function renderWeek() {
    if (!weekGrid || !weekLabel) return;

    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);

    weekLabel.textContent = `${weekStart.toLocaleDateString([], {month:"short", day:"numeric"})} – ${end.toLocaleDateString([], {month:"short", day:"numeric"})}`;
    weekGrid.innerHTML = "";

    for (let i=0;i<7;i++){
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateStr = ymd(d);

        const col = document.createElement("div");
        col.className = "day-col";
        col.innerHTML = `
      <div class="day-head">
        <div class="day-name">${d.toLocaleDateString([], {weekday:"short"})}</div>
        <div class="day-date">${d.toLocaleDateString([], {month:"short", day:"numeric"})}</div>
      </div>
      <div class="day-events" data-date="${dateStr}"></div>
    `;

        const eventsWrap = col.querySelector(".day-events");
        const list = eventsOnDate(dateStr);

        list.forEach(ev => {
            const pill = document.createElement("div");
            pill.className = "event-pill";
            pill.title = "Click to delete";
            pill.textContent = `${ev.time} • ${ev.title}`;
            pill.addEventListener("click", () => {
                if (!confirm(`Delete "${ev.title}"?`)) return;
                schedule = schedule.filter(x => x.id !== ev.id);
                save("sl_schedule", schedule);
                renderSchedule();
                renderHome();
                renderWeek();
                if (notificationsEnabled) scheduleAllReminders();
            });
            eventsWrap.appendChild(pill);
        });

        // double click day to add
        col.addEventListener("dblclick", () => {
            const title = prompt("Event name?");
            if (!title) return;
            const time = prompt("Time? (HH:MM)", "16:00");
            if (!time) return;

            schedule.push({ id: crypto.randomUUID(), title: title.trim(), date: dateStr, time: time.trim() });
            save("sl_schedule", schedule);
            renderSchedule();
            renderHome();
            renderWeek();
            if (notificationsEnabled) scheduleAllReminders();
        });

        weekGrid.appendChild(col);
    }
}

// ---------- grades ----------
const gradeList = $("#gradeList");
const gradeEmpty = $("#gradeEmpty");
const avgPill = $("#avgPill");
const countPill = $("#countPill");

function calcWeightedAverage() {
    if (!grades.length) return null;
    let total = 0;
    let wsum = 0;
    for (const g of grades) {
        total += g.grade * g.weight;
        wsum += g.weight;
    }
    return total / wsum;
}

function renderGrades() {
    if (!gradeList) return;

    gradeList.innerHTML = "";
    if (gradeEmpty) gradeEmpty.style.display = grades.length ? "none" : "block";

    const avg = calcWeightedAverage();
    if (avgPill) avgPill.textContent = avg == null ? "Average: —" : `Average: ${avg.toFixed(1)}%`;
    if (countPill) countPill.textContent = `Courses: ${grades.length}`;

    grades.forEach((g) => {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = `
      <div class="left">
        <div class="text" title="${g.course}">
          <strong>${g.course}</strong> • ${g.grade}% (w ${g.weight}x)
        </div>
      </div>
      <button class="ghost">Delete</button>
    `;
        li.querySelector("button").addEventListener("click", () => {
            grades = grades.filter(x => x.id !== g.id);
            save("sl_grades", grades);
            renderGrades();
            renderHome();
            drawGradeCharts();
        });
        gradeList.appendChild(li);
    });
}

const gradeForm = $("#gradeForm");
if (gradeForm) {
    gradeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const course = ($("#courseName")?.value || "").trim();
        const grade = Number($("#courseGrade")?.value);
        const weight = Number($("#courseWeight")?.value);
        if (!course || Number.isNaN(grade)) return;

        grades.push({ id: crypto.randomUUID(), course, grade, weight });
        save("sl_grades", grades);

        $("#courseName").value = "";
        $("#courseGrade").value = "";
        $("#courseWeight").value = "1";

        renderGrades();
        renderHome();
        drawGradeCharts();
    });
}

const clearGradesBtn = $("#clearGrades");
if (clearGradesBtn) {
    clearGradesBtn.addEventListener("click", () => {
        grades = [];
        save("sl_grades", grades);
        renderGrades();
        renderHome();
        drawGradeCharts();
    });
}

// ---------- charts ----------
function drawBarChart(canvas, labels, values) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.height; // keep provided height
    ctx.clearRect(0,0,w,h);

    // grid
    ctx.globalAlpha = 0.35;
    for (let i=0;i<=4;i++){
        const y = (h-20) - (i*(h-40)/4);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.strokeStyle = "rgba(255,255,255,.12)";
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (!values.length) return;

    const maxV = 100;
    const pad = 18;
    const chartH = h - 40;
    const barW = Math.max(10, (w - pad*2) / values.length - 10);

    values.forEach((v, i) => {
        const x = pad + i * (barW + 10);
        const barH = Math.max(2, (v / maxV) * chartH);
        const y = (h - 20) - barH;

        ctx.fillStyle = "rgba(124,92,255,.55)";
        ctx.fillRect(x, y, barW, barH);

        ctx.fillStyle = "rgba(230,237,247,.9)";
        ctx.font = "12px system-ui";
        ctx.fillText(`${Math.round(v)}%`, x, y - 6);

        const label = labels[i].length > 8 ? labels[i].slice(0,8) + "…" : labels[i];
        ctx.fillStyle = "rgba(159,176,199,.9)";
        ctx.fillText(label, x, h - 6);
    });
}

function drawGradeCharts(){
    const labels = grades.map(g => g.course);
    const values = grades.map(g => g.grade);
    drawBarChart($("#gradeChart"), labels, values);
    drawBarChart($("#gradeChartHome"), labels.slice(0,6), values.slice(0,6));
}

// ---------- notes ----------
const notesArea = $("#notesArea");
if (notesArea) {
    notesArea.value = notes;
    notesArea.addEventListener("input", () => {
        localStorage.setItem("sl_notes", notesArea.value);
    });
}

// ---------- home widgets ----------
const nextUpList = $("#nextUpList");
const nextUpEmpty = $("#nextUpEmpty");
const gradesSummary = $("#gradesSummary");
const gradesEmpty = $("#gradesEmpty");

function renderHome() {
    // next up: upcoming events + due tasks
    sortSchedule();
    const now = new Date();

    const upcomingEvents = schedule
        .map(ev => ({ type:"event", title: ev.title, dt: new Date(ev.date + "T" + ev.time), meta: formatDateTime(ev.date, ev.time) }))
        .filter(x => x.dt >= now);

    const soonTasks = tasks
        .filter(t => !t.done && t.due)
        .map(t => ({
            type:"task",
            title: t.text,
            dt: new Date(t.due + "T08:00"),
            meta: `Due: ${new Date(t.due).toLocaleDateString()} • ${String(t.priority||"med").toUpperCase()}`
        }))
        .filter(x => (x.dt.getTime() - now.getTime()) <= 7*24*60*60*1000 || x.dt < now);

    const combined = [...upcomingEvents, ...soonTasks]
        .sort((a,b) => a.dt - b.dt)
        .slice(0,4);

    if (nextUpList) nextUpList.innerHTML = "";
    if (nextUpEmpty) nextUpEmpty.style.display = combined.length ? "none" : "block";

    combined.forEach(x => {
        const li = document.createElement("li");
        li.className = "item";
        li.innerHTML = `
      <div class="left">
        <div class="text">
          <strong>${x.type === "task" ? "📝" : "📅"} ${x.title}</strong>
          <span class="muted"> • ${x.meta}</span>
        </div>
      </div>
      <span class="muted">${x.dt.toLocaleDateString([], { month:"short", day:"numeric" })}</span>
    `;
        if (nextUpList) nextUpList.appendChild(li);
    });

    // summary pills
    if (gradesSummary) gradesSummary.innerHTML = "";
    if (gradesEmpty) gradesEmpty.style.display = grades.length ? "none" : "block";

    const avg = calcWeightedAverage();
    if (avg != null && gradesSummary) {
        const pill = document.createElement("div");
        pill.className = "pill";
        pill.textContent = `Weighted avg: ${avg.toFixed(1)}%`;
        gradesSummary.appendChild(pill);
    }

    const openTasks = tasks.filter(t => !t.done).length;
    if (gradesSummary) {
        const pill2 = document.createElement("div");
        pill2.className = "pill";
        pill2.textContent = `Open tasks: ${openTasks}`;
        gradesSummary.appendChild(pill2);

        const upcomingCount = schedule.filter(ev => new Date(ev.date + "T" + ev.time) >= now).length;
        const pill3 = document.createElement("div");
        pill3.className = "pill";
        pill3.textContent = `Upcoming events: ${upcomingCount}`;
        gradesSummary.appendChild(pill3);
    }
}

// ---------- clear all ----------
const clearAllBtn = $("#clearAll");
if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
        if (!confirm("Clear ALL saved dashboard data on this device?")) return;

        localStorage.removeItem("sl_tasks");
        localStorage.removeItem("sl_schedule");
        localStorage.removeItem("sl_grades");
        localStorage.removeItem("sl_notes");
        localStorage.removeItem("sl_name");
        localStorage.removeItem("sl_notify");

        tasks = [];
        schedule = [];
        grades = [];
        studentName = "";
        notificationsEnabled = false;
        if (enableNotifications) enableNotifications.checked = false;
        clearAllReminderTimers();
        if (notesArea) notesArea.value = "";

        renderTasks();
        renderSchedule();
        renderGrades();
        renderHome();
        renderWeek();
        drawGradeCharts();
        setView("home");
        showGateIfNeeded();
    });
}

// ---------- initial render ----------
renderTasks();
renderSchedule();
renderGrades();
renderHome();
renderWeek();
drawGradeCharts();
setView("home");

if (notificationsEnabled) {
    if (enableNotifications) enableNotifications.checked = true;
    if ("Notification" in window && Notification.permission === "granted") {
        scheduleAllReminders();
    }
}