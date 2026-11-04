const f = document.getElementById('f');
    const err = document.getElementById('err');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      const btn = f.querySelector('button');
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ loginId: f.id.value, password: f.pw.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '로그인하지 못했습니다');
        location.href = '/';
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
        btn.disabled = false;
      }
    });
