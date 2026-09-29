// 공통 헬퍼: API 호출, 상단 내비게이션, 메시지 표시
async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 본문 없음 */
  }
  return { ok: res.ok, status: res.status, data };
}

function showMessage(text, isError) {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = isError ? 'message error' : 'message success';
  el.setAttribute('role', isError ? 'alert' : 'status');
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

async function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return null;
  const { data } = await api('GET', '/api/me');
  const user = data && data.user;
  nav.textContent = '';

  const home = document.createElement('a');
  home.href = '/';
  home.textContent = '게시판';
  home.className = 'brand';
  nav.appendChild(home);

  const right = document.createElement('span');
  right.className = 'nav-right';

  if (user) {
    const who = document.createElement('span');
    who.id = 'nav-user';
    who.textContent = user.nickname + ' 님';
    right.appendChild(who);

    const write = document.createElement('a');
    write.href = '/write.html';
    write.textContent = '글쓰기';
    right.appendChild(write);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '로그아웃';
    btn.addEventListener('click', async () => {
      await api('POST', '/api/logout');
      location.href = '/';
    });
    right.appendChild(btn);
  } else {
    const login = document.createElement('a');
    login.href = '/login.html';
    login.textContent = '로그인';
    right.appendChild(login);

    const signup = document.createElement('a');
    signup.href = '/signup.html';
    signup.textContent = '회원가입';
    right.appendChild(signup);
  }
  nav.appendChild(right);
  return user || null;
}
