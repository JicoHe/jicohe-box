/* === Jico He / shared scripts === */

/* Language */
function setLang(lang) {
    document.documentElement.lang = lang;
    localStorage.setItem('lang', lang);
    var zh = document.getElementById('lang-zh');
    var en = document.getElementById('lang-en');
    if (zh) zh.classList.toggle('on', lang === 'zh');
    if (en) en.classList.toggle('on', lang === 'en');
    var mzh = document.getElementById('mml-zh');
    var men = document.getElementById('mml-en');
    if (mzh) mzh.classList.toggle('on', lang === 'zh');
    if (men) men.classList.toggle('on', lang === 'en');
}
(function() {
    setLang(localStorage.getItem('lang') || 'zh');
})();

/* Theme */
function getTheme() { return localStorage.getItem("theme") || "auto"; }
function applyTheme() {
    var isDark = getTheme() === "dark" || (getTheme() === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    var btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = isDark ? "浅色" : "深色";
    var mbtn = document.getElementById("mml-theme");
    if (mbtn) mbtn.textContent = isDark ? "浅色" : "深色";
}
function toggleTheme() {
    localStorage.setItem("theme", document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    applyTheme();
}
applyTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function() {
    if (getTheme() === "auto") applyTheme();
});

/* Admin */
var ADMIN_SESSION_KEY = "jicohe_admin_session";
var SESSION_DURATION = 24 * 60 * 60 * 1000;

function isLoggedIn() {
    var data = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!data) return false;
    try {
        var session = JSON.parse(data);
        if (Date.now() - session.timestamp > SESSION_DURATION) {
            localStorage.removeItem(ADMIN_SESSION_KEY);
            return false;
        }
        return true;
    } catch (e) { return false; }
}

function setLoggedIn() {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ timestamp: Date.now() }));
    var dot = document.getElementById("admin-dot");
    if (dot) dot.classList.add("logged-in");
}

function logoutAdmin() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    var dot = document.getElementById("admin-dot");
    if (dot) dot.classList.remove("logged-in");
    closeAdmin();
}

if (isLoggedIn()) {
    var dot = document.getElementById("admin-dot");
    if (dot) dot.classList.add("logged-in");
}

function openAdmin() {
    if (isLoggedIn()) {
        document.getElementById("admin-overlay").classList.add("active");
        document.getElementById("admin-modal").style.display = "none";
        document.getElementById("admin-dashboard").classList.add("active");
        fetchBalance();
        return;
    }
    document.getElementById("admin-overlay").classList.add("active");
    document.getElementById("admin-modal").style.display = "block";
    document.getElementById("admin-dashboard").classList.remove("active");
    document.getElementById("pw-input").value = "";
    document.getElementById("lock-msg").textContent = "";
    document.getElementById("lock-msg").className = "lock-msg";
    setTimeout(function() { document.getElementById("pw-input").focus(); }, 100);
}

function closeAdmin() {
    document.getElementById("admin-overlay").classList.remove("active");
    document.getElementById("admin-modal").style.display = "";
    document.getElementById("admin-dashboard").classList.remove("active");
}

function closeDashboard() { closeAdmin(); }

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeAdmin();
});
document.addEventListener("click", function(e) {
    var overlay = document.getElementById("admin-overlay");
    if (overlay && e.target === overlay) closeAdmin();
});

async function verifyPassword() {
    var pw = document.getElementById("pw-input").value;
    var msg = document.getElementById("lock-msg");
    var zh = document.documentElement.lang === 'zh';
    if (!pw) {
        msg.textContent = zh ? "请输入密码" : "Enter password";
        msg.className = "lock-msg error";
        return;
    }
    msg.textContent = zh ? "验证中…" : "Verifying…";
    msg.className = "lock-msg";
    try {
        var r = await fetch("/api/password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw })
        });
        var d = await r.json();
        if (d.status === "ok") {
            setLoggedIn();
            document.getElementById("admin-modal").style.display = "none";
            document.getElementById("admin-dashboard").classList.add("active");
            fetchBalance();
        } else {
            msg.textContent = (d.error && d.error.indexOf("not configured") !== -1)
                ? (zh ? "后台未配置密码" : "Password not configured")
                : (zh ? "密码错误" : "Wrong password");
            msg.className = "lock-msg error";
            document.getElementById("pw-input").value = "";
            document.getElementById("pw-input").focus();
        }
    } catch (e) {
        msg.textContent = zh ? "请求失败" : "Request failed";
        msg.className = "lock-msg error";
    }
}

async function fetchBalance() {
    var b = document.getElementById("ds-balance");
    var m = document.getElementById("ds-meta");
    if (!b) return;
    try {
        var r = await fetch("/api/deepseek");
        if (!r.ok) throw new Error();
        var d = await r.json();
        b.textContent = "¥" + parseFloat(d.balance_infos ? d.balance_infos[0].total_balance : (d.total_balance || 0)).toFixed(2);
        m.textContent = "DeepSeek API";
    } catch (e) {
        b.textContent = "—";
        m.textContent = "查询失败";
    }
}
setInterval(function() {
    if (document.getElementById("admin-dashboard").classList.contains("active")) fetchBalance();
}, 60000);

document.addEventListener("keydown", function(e) {
    if (e.key === "m" && !e.target.closest("input,textarea") && !document.getElementById("admin-overlay").classList.contains("active")) {
        openAdmin();
    }
});

/* Mobile menu */
function toggleMobileMenu() {
    var hamburger = document.querySelector(".nav-hamburger");
    var menu = document.getElementById("mobile-menu");
    if (!hamburger || !menu) return;
    var open = !menu.classList.contains("open");
    if (open) {
        menu.classList.add("open");
        menu.style.display = "flex";
        hamburger.classList.add("open");
    } else {
        menu.classList.remove("open");
        menu.style.display = "none";
        hamburger.classList.remove("open");
    }
    document.body.style.overflow = open ? "hidden" : "";
}
document.addEventListener("click", function(e) {
    var menu = document.getElementById("mobile-menu");
    if (menu && menu.classList.contains("open") && e.target === menu) {
        toggleMobileMenu();
    }
});
