/* ИС «Книжный фонд» — клиентская логика демо-версии.
   Авторизация и регистрация работают с «базой» в localStorage, заполненной из seed.json.
   В реальной системе проверки паролей и запись в БД выполняет сервер (bcrypt, PostgreSQL). */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- настройки */
  var TODAY = '2026-10-31';                       // «сегодняшняя» дата тестовых данных
  var DB_KEY = 'kf_db_v1', SESSION_KEY = 'kf_session_v1', FAILS_KEY = 'kf_fails_v1';
  var TTL = { reader: 8 * 3600e3, librarian: 30 * 60e3, admin: 30 * 60e3 };   // срок сессии по ТЗ
  var MAX_FAILS = 5, LOCK_MS = 15 * 60e3;         // блокировка после 5 неудачных попыток
  var ROLE_NAME = { reader: 'читатель', librarian: 'библиотекарь', admin: 'администратор' };
  var ROLE_HOME = { reader: 'catalog', librarian: 'desk', admin: 'admin' };
  var VIEW_ROLE = { catalog: 'reader', formular: 'reader', profile: 'reader',
    desk: 'librarian', 'return': 'librarian', transfer: 'librarian',
    admin: 'admin', intake: 'admin', directories: 'admin', staff: 'admin', reports: 'admin', audit: 'admin' };

  /* ---------------------------------------------------------------- регулярные выражения */
  var RX = {
    login:         /^[A-Za-z][A-Za-z0-9._-]{2,49}$/,                      // users.login varchar(50)
    passwordLogin: /^\S{8,64}$/,                                          // при входе: без пробелов
    password:      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)\S{8,64}$/,            // при регистрации: a-z, A-Z, цифра
    fullName:      /^(?=.{5,150}$)\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?(?:\s\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?){1,2}$/u,
    email:         /^(?=.{6,120}$)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/,
    phone:         /^(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}$/,
    ticket:        /^\d{4}-\d{4}$/                                        // как в readers.ticket_number
  };
  var MSG = {
    required:      'Поле обязательно для заполнения',
    login:         'Логин: 3–50 символов, начинается с латинской буквы; допустимы цифры и знаки . _ -',
    passwordLogin: 'Пароль: 8–64 символа без пробелов',
    password:      'Пароль: 8–64 символа без пробелов, с заглавной и строчной латинскими буквами и цифрой',
    password2:     'Пароли не совпадают',
    fullName:      'Укажите фамилию, имя (и отчество) с заглавной буквы, например: Иванова Мария Петровна',
    email:         'Введите корректный адрес, например: name@example.com',
    phone:         'Формат: +7 (900) 123-45-67 или 8 900 123-45-67',
    ticket:        'Номер билета в формате NNNN-NNNN, например: 2026-0417',
    agree:         'Необходимо согласие на обработку персональных данных'
  };

  /* ---------------------------------------------------------------- хранилище */
  var mem = {};
  function load(key) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return mem[key] || null; } }
  function save(key, val) { try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { mem[key] = val; } }

  function demoHash(s) {                           // демо-хэш: пароль в открытом виде не хранится
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 'demo$' + h.toString(16);
  }
  /* [id, логин, ФИО, email, телефон, роль, активен, билет, подтверждён, пароль] — из seed.json */
  var SEED = [
    [1, 'p.kuznetsov', 'Павел Кузнецов', 'p.kuznetsov@library.example', '+7 (916) 100-20-01', 'admin', 1, null, 0, 'Admin#2026'],
    [2, 'a.sokolova', 'Анна Соколова', 'a.sokolova@library.example', '+7 (916) 100-20-02', 'librarian', 1, null, 0, 'Staff#2026'],
    [3, 'd.orlov', 'Дмитрий Орлов', 'd.orlov@library.example', '+7 (916) 100-20-03', 'librarian', 1, null, 0, 'Staff#2026'],
    [4, 'e.krylova', 'Елена Крылова', 'e.krylova@library.example', '+7 (916) 100-20-04', 'librarian', 1, null, 0, 'Staff#2026'],
    [5, 's.gromov', 'Сергей Громов', 's.gromov@library.example', '+7 (916) 100-20-05', 'librarian', 0, null, 0, 'Staff#2026'],
    [6, 'm.reinhardt', 'Майя Рейнхардт', 'maya.reinhardt@example.com', '+7 (903) 211-45-17', 'reader', 1, '2026-0417', 1, 'Reader#2026'],
    [7, 'i.vorontsov', 'Илья Воронцов', 'ilya.vorontsov@example.com', '+7 (905) 340-12-33', 'reader', 1, '2026-0233', 1, 'Reader#2026'],
    [8, 'a.laptev', 'Артём Лаптев', 'artem.laptev@example.com', '+7 (926) 518-77-09', 'reader', 1, '2026-0118', 1, 'Reader#2026'],
    [9, 'n.belova', 'Нина Белова', 'nina.belova@example.com', '+7 (915) 662-30-41', 'reader', 1, '2026-0341', 1, 'Reader#2026'],
    [10, 'g.shiryaev', 'Глеб Ширяев', 'gleb.shiryaev@example.com', '+7 (917) 450-86-22', 'reader', 1, '2026-0275', 1, 'Reader#2026'],
    [11, 'o.melnikova', 'Ольга Мельникова', 'olga.melnikova@example.com', '+7 (909) 127-64-58', 'reader', 1, '2026-0390', 1, 'Reader#2026'],
    [12, 'p.lebedev', 'Пётр Лебедев', 'petr.lebedev@example.com', '+7 (925) 733-19-04', 'reader', 1, '2026-0156', 1, 'Reader#2026'],
    [13, 's.gromova', 'Светлана Громова', 'svetlana.gromova@example.com', '+7 (911) 804-25-70', 'reader', 1, '2026-0462', 1, 'Reader#2026'],
    [14, 'k.nazarov', 'Кирилл Назаров', 'kirill.nazarov@example.com', '+7 (968) 395-41-86', 'reader', 1, '2026-0309', 1, 'Reader#2026'],
    [15, 't.egorova', 'Татьяна Егорова', 'tatiana.egorova@example.com', '+7 (985) 276-93-15', 'reader', 1, '2026-0502', 0, 'Reader#2026']
  ];
  /* открытые выдачи: [логин читателя, книга, инв. номер, выдана, вернуть до] */
  var LOANS = [
    ['m.reinhardt', 'Тихий Дон', 'КФ-003977', '2026-10-03', '2026-10-17'],
    ['m.reinhardt', 'Алгоритмы: построение и анализ', 'КФ-007102', '2026-10-22', '2026-11-05'],
    ['m.reinhardt', 'Мастер и Маргарита', 'КФ-004218', '2026-10-12', '2026-11-09'],
    ['a.laptev', 'Тихий Дон', 'КФ-003975', '2026-09-25', '2026-10-09'],
    ['n.belova', 'Война и мир. Том 1', 'КФ-006100', '2026-10-08', '2026-10-22'],
    ['g.shiryaev', 'Идиот', 'КФ-001690', '2026-10-12', '2026-10-26'],
    ['i.vorontsov', 'Отцы и дети', 'КФ-001450', '2026-10-24', '2026-11-07'],
    ['o.melnikova', 'Преступление и наказание', 'КФ-005530', '2026-10-19', '2026-11-02'],
    ['p.lebedev', 'Мастер и Маргарита', 'КФ-004216', '2026-10-20', '2026-11-03'],
    ['s.gromova', 'Война и мир. Том 1', 'КФ-006101', '2026-10-31', '2026-11-14'],
    ['k.nazarov', 'Преступление и наказание', 'КФ-005529', '2026-10-25', '2026-11-08'],
    ['k.nazarov', 'Война и мир. Том 1', 'КФ-006102', '2026-10-29', '2026-11-12']
  ];
  function seedDb() {
    return { nextId: 16, users: SEED.map(function (r) {
      return { id: r[0], login: r[1], fullName: r[2], email: r[3], phone: r[4], role: r[5], active: !!r[6],
               ticket: r[7], verified: !!r[8], hash: demoHash(r[9]) };
    }) };
  }
  function getDb() { var db = load(DB_KEY); if (!db) { db = seedDb(); save(DB_KEY, db); } return db; }

  /* ---------------------------------------------------------------- вспомогательное */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
  function fmt(iso) { var p = iso.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function days(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 864e5); }

  var flash = null, toastTimer;
  function setFlash(text, type) { flash = { text: text, type: type || 'info' }; }
  function toast(text) {
    var t = $('#toast'); t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function formMsg(el, text, type) {
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.className = 'form-msg form-msg--' + (type || 'info'); el.textContent = text; el.hidden = false;
  }

  /* ---------------------------------------------------------------- сессия */
  function getSession() {
    var s = load(SESSION_KEY);
    if (s && s.expires < Date.now()) { save(SESSION_KEY, null); setFlash('Сессия истекла. Войдите снова.', 'info'); return null; }
    return s;
  }
  function startSession(u) {
    save(SESSION_KEY, { id: u.id, login: u.login, role: u.role, fullName: u.fullName, ticket: u.ticket, verified: u.verified, expires: Date.now() + TTL[u.role] });
  }
  function logout(message) {
    save(SESSION_KEY, null);
    setFlash(message || 'Вы вышли из системы.', 'success');
    go('login');
  }

  /* ---------------------------------------------------------------- валидация */
  function checkField(input, form) {
    var rule = input.dataset.rule;
    if (rule === 'agree') return input.checked ? '' : MSG.agree;
    var v = input.type === 'password' ? input.value : input.value.trim();
    if (v === '') return input.hasAttribute('data-optional') ? '' : MSG.required;
    if (rule === 'password2') return v === form.elements.password.value ? '' : MSG.password2;
    return RX[rule].test(v) ? '' : MSG[rule];
  }
  function setState(input, error) {
    var box = document.getElementById(input.id + '-error');
    if (box) box.textContent = error || '';
    input.classList.toggle('field__input--invalid', !!error);
    input.classList.toggle('field__input--valid', !error && input.value !== '' && input.type !== 'checkbox');
    input.setAttribute('aria-invalid', error ? 'true' : 'false');
  }
  function validateForm(form) {
    var first = null;
    $all('[data-rule]', form).forEach(function (input) {
      var err = checkField(input, form); setState(input, err); input.dataset.touched = '1';
      if (err && !first) first = input;
    });
    if (first) first.focus();
    return !first;
  }
  function bindLive(form) {                        // проверка «на лету» после первого ухода из поля
    form.addEventListener('focusout', function (e) {
      if (e.target.dataset && e.target.dataset.rule) { e.target.dataset.touched = '1'; setState(e.target, checkField(e.target, form)); }
    });
    form.addEventListener('input', function (e) {
      var t = e.target; if (!t.dataset || !t.dataset.rule) return;
      if (t.dataset.touched) setState(t, checkField(t, form));
      if (t.name === 'password') { var p2 = form.elements.password2; if (p2 && p2.dataset.touched) setState(p2, checkField(p2, form)); }
    });
    form.addEventListener('change', function (e) {
      if (e.target.type === 'checkbox') setState(e.target, checkField(e.target, form));
    });
  }

  /* ---------------------------------------------------------------- вход */
  function failsOf(login) { var f = load(FAILS_KEY) || {}; return f[login.toLowerCase()] || { n: 0, until: 0 }; }
  function putFails(login, rec) { var f = load(FAILS_KEY) || {}; if (rec) f[login.toLowerCase()] = rec; else delete f[login.toLowerCase()]; save(FAILS_KEY, f); }

  function onLogin(e) {
    e.preventDefault();
    var form = e.target, msg = $('#login-msg');
    formMsg(msg, '');
    var s = getSession();
    if (s) { formMsg(msg, 'Вы уже вошли как ' + s.fullName + '. Сначала выйдите из личного кабинета.', 'info'); return; }
    if (!validateForm(form)) { formMsg(msg, 'Проверьте поля формы: есть ошибки.', 'error'); return; }
    var login = form.elements.login.value.trim(), pass = form.elements.password.value;
    var f = failsOf(login);
    if (f.until > Date.now()) { formMsg(msg, 'Слишком много неудачных попыток. Повторите через ' + Math.ceil((f.until - Date.now()) / 60e3) + ' мин.', 'error'); return; }
    var user = getDb().users.filter(function (u) { return u.login.toLowerCase() === login.toLowerCase(); })[0];
    if (!user || user.hash !== demoHash(pass)) {                    // авторизоваться могут только пользователи из БД
      f.n += 1; if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
      putFails(login, f);
      formMsg(msg, f.until > Date.now() ? 'Слишком много неудачных попыток. Вход заблокирован на 15 минут.' : 'Неверный логин или пароль. Осталось попыток: ' + (MAX_FAILS - f.n) + '.', 'error');
      return;
    }
    if (!user.active) { formMsg(msg, 'Учётная запись деактивирована. Обратитесь к администратору библиотеки.', 'error'); return; }
    putFails(login, null);
    startSession(user);
    form.reset(); $all('[data-rule]', form).forEach(function (i) { setState(i, ''); delete i.dataset.touched; });
    setFlash('Здравствуйте, ' + user.fullName + '! Вы вошли как ' + ROLE_NAME[user.role] + '.', 'success');
    go(ROLE_HOME[user.role]);                                        // личный кабинет по роли
  }

  /* ---------------------------------------------------------------- регистрация */
  function onRegister(e) {
    e.preventDefault();
    var form = e.target, msg = $('#register-msg'); formMsg(msg, '');
    if (getSession()) { formMsg(msg, 'Вы уже вошли в систему. Выйдите, чтобы зарегистрировать другую учётную запись.', 'info'); return; }
    if (!validateForm(form)) { formMsg(msg, 'Проверьте поля формы: есть ошибки.', 'error'); return; }
    var el = form.elements, db = getDb(), clash = false;
    var rec = { fullName: el.fullName.value.trim(), ticket: el.ticket.value.trim(), email: el.email.value.trim(),
                phone: el.phone.value.trim() || null, login: el.login.value.trim() };
    [['login', function (u) { return u.login.toLowerCase() === rec.login.toLowerCase(); }, 'Этот логин уже занят'],
     ['email', function (u) { return u.email && u.email.toLowerCase() === rec.email.toLowerCase(); }, 'Этот адрес уже зарегистрирован'],
     ['ticket', function (u) { return u.ticket === rec.ticket; }, 'Этот читательский билет уже привязан к другой учётной записи']
    ].forEach(function (c) { if (db.users.some(c[1])) { setState(el[c[0]], c[2]); clash = true; } });
    if (clash) { formMsg(msg, 'Регистрация отклонена: данные уже есть в базе.', 'error'); return; }
    var user = { id: db.nextId, login: rec.login, fullName: rec.fullName, email: rec.email, phone: rec.phone, role: 'reader',
                 active: true, ticket: rec.ticket, verified: false, hash: demoHash(el.password.value) };
    db.nextId += 1; db.users.push(user); save(DB_KEY, db);          // данные заносятся в «базу»
    form.reset(); $all('[data-rule]', form).forEach(function (i) { setState(i, ''); delete i.dataset.touched; });
    formMsg(msg, 'Заявка принята: запись № ' + user.id + ' добавлена в базу (users, readers). Войти можно сразу, но формуляры станут доступны после подтверждения регистрации библиотекарем.', 'success');
  }

  /* ---------------------------------------------------------------- маршрутизация и доступ */
  var MENUS = {
    librarian: [['desk', 'Выдача и возврат'], ['transfer', 'Перемещение'], [0, 'Читатели'], [0, 'Каталог'], [0, 'Списание']],
    admin: [['admin', 'Обзор'], ['intake', 'Поступления'], ['directories', 'Справочники'], ['staff', 'Сотрудники'], ['reports', 'Отчёты'], ['audit', 'Журнал действий']]
  };
  var SAME = { 'return': 'desk' };

  function go(id) { if (location.hash.slice(1) === id) route(); else location.hash = id; }

  function route() {
    var id = location.hash.slice(1) || 'login';
    var viewEl = document.getElementById(id);
    if (!viewEl || !viewEl.classList.contains('view')) id = 'login';
    var s = getSession(), need = VIEW_ROLE[id];
    if (!need && s) {                                                // уже авторизован: повторный вход недоступен
      setFlash('Вы уже вошли как ' + s.fullName + '.', 'info'); return go(ROLE_HOME[s.role]);
    }
    if (need && !s) { setFlash('Войдите, чтобы открыть личный кабинет.', 'info'); return go('login'); }
    if (need && s.role !== need) { setFlash('Нет доступа к этому разделу.', 'error'); return go(ROLE_HOME[s.role]); }
    $all('.view').forEach(function (v) { v.hidden = v.id !== id; });
    render(id, s);
    window.scrollTo(0, 0);
  }

  function render(id, s) {
    $all('[data-user-name]').forEach(function (n) { n.textContent = s ? s.fullName : ''; });
    $all('[data-user-ticket]').forEach(function (n) { n.textContent = s && s.ticket ? 'Читательский билет № ' + s.ticket : ''; });
    $all('.js-unverified').forEach(function (n) {
      n.hidden = !(s && s.role === 'reader' && !s.verified);
      n.textContent = 'Регистрация ещё не подтверждена библиотекарем: каталог доступен, формуляр появится после подтверждения.';
    });
    $all('[data-sidebar]').forEach(function (side) {
      var items = MENUS[side.dataset.sidebar] || [], cur = SAME[id] || id;
      side.innerHTML = '<p class="sidebar__logo">Книжный фонд</p>' + items.map(function (i) {
        return i[0] ? '<a class="sidebar__item' + (i[0] === cur ? ' sidebar__item--active' : '') + '" href="#' + i[0] + '">' + i[1] + '</a>'
                    : '<button class="sidebar__item" type="button" data-toast="Этот раздел появится позже">' + i[1] + '</button>';
      }).join('') + '<button class="sidebar__item" type="button" data-logout>Выйти</button><p class="sidebar__user"></p>';
      if (s) $('.sidebar__user', side).textContent = s.fullName + ', ' + ROLE_NAME[s.role];
    });
    if (id === 'formular' && s) renderFormular(s);
    if (id === 'login' || id === 'register') { var m = $('#' + id + '-msg'); if (flash) { formMsg(m, flash.text, flash.type); flash = null; } }
    else if (flash) { toast(flash.text); flash = null; }
  }

  function renderFormular(s) {
    var body = $('#formular-body'), box = $('#formular-alert');
    body.textContent = ''; box.hidden = true;
    if (!s.verified) { box.textContent = 'Формуляр недоступен: регистрация не подтверждена библиотекарем.'; box.hidden = false; return; }
    var loans = LOANS.filter(function (l) { return l[0] === s.login; });
    var overdue = loans.filter(function (l) { return days(TODAY, l[4]) > 0; });
    if (overdue.length) { box.textContent = 'Просрочено книг: ' + overdue.length + '. Верните их в абонемент: до возврата новые выдачи недоступны.'; box.hidden = false; }
    if (!loans.length) { var empty = document.createElement('p'); empty.className = 'table__empty'; empty.textContent = 'У вас нет книг на руках.'; body.appendChild(empty); return; }
    loans.forEach(function (l) {
      var late = days(TODAY, l[4]), left = -late, row = document.createElement('div');
      row.className = 'table__row';
      var cls = late > 0 ? 'badge badge--bad' : left <= 7 ? 'badge badge--warn' : 'badge';
      var txt = late > 0 ? 'Просрочено на ' + late + ' дн.' : left <= 7 ? 'Осталось ' + left + ' дн.' : 'На руках';
      [[l[1], 'table__cell--strong'], [l[2], ''], [fmt(l[3]), ''], [fmt(l[4]), '']].forEach(function (c) {
        var sp = document.createElement('span'); sp.textContent = c[0]; if (c[1]) sp.className = c[1]; row.appendChild(sp);
      });
      var cell = document.createElement('span'), b = document.createElement('b'); b.className = cls; b.textContent = txt; cell.appendChild(b); row.appendChild(cell);
      body.appendChild(row);
    });
  }

  /* ---------------------------------------------------------------- события интерфейса */
  function closeModals() { $all('.modal').forEach(function (m) { m.hidden = true; }); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('button, a, .modal');
    if (!el) return;
    if (el.classList.contains('modal')) { if (e.target === el) closeModals(); return; }
    if (el.hasAttribute('data-logout')) { logout(); return; }
    if (el.dataset.fillLogin) {                                      // подстановка тестовой учётной записи
      var f = $('#login-form'); f.elements.login.value = el.dataset.fillLogin; f.elements.password.value = el.dataset.fillPass;
      $all('[data-rule]', f).forEach(function (i) { setState(i, ''); }); f.elements.password.focus(); return;
    }
    if (el.hasAttribute('data-reset-db')) { save(DB_KEY, null); save(FAILS_KEY, null); save(SESSION_KEY, null); toast('Тестовая база сброшена'); go('login'); return; }
    if (el.dataset.modalOpen) document.getElementById(el.dataset.modalOpen).hidden = false;
    if (el.hasAttribute('data-modal-close')) closeModals();
    if (el.dataset.toast) toast(el.dataset.toast);
    if (el.hasAttribute('data-remove')) el.closest('.copy').remove();
    if (el.classList.contains('option')) $all('.option', el.parentNode).forEach(function (o) { o.classList.toggle('option--active', o === el); });
    if (el.classList.contains('toggle')) {
      var on = el.classList.toggle('toggle--on'); el.setAttribute('aria-checked', on);
      toast(on ? 'Напоминания включены' : 'Напоминания отключены');
    }
    if (el.classList.contains('chip')) {
      $all('.chip', el.parentNode).forEach(function (c) { c.classList.toggle('chip--active', c === el); });
      if (el.dataset.filter) $all('#audit [data-type]').forEach(function (r) { r.hidden = el.dataset.filter !== 'all' && r.dataset.type !== el.dataset.filter; });
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModals(); });

  var loginForm = $('#login-form'), regForm = $('#register-form');
  loginForm.addEventListener('submit', onLogin); bindLive(loginForm);
  regForm.addEventListener('submit', onRegister); bindLive(regForm);
  addEventListener('hashchange', route);
  getDb(); route();
})();
