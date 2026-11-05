// 세척 신호 받기. 송신부(ESP32, 이름 'ECOG')는 BLE notify 로 한 글자씩 보낸다.
//   N: 대기(1초마다)  A: 세척 시작  S: 정상 종료(5초 이상)  F: 5초 안에 끝남
// 어댑터 세 가지가 같은 모양으로 동작한다 (이벤트 'state', 'data', 'devices').
//   native : 안드로이드 껍데기 앱(APK). 블루투스는 앱이 직접 잡는다. 잠깐 찾아서 신호가 가장 센(가까운) ECOG 에
//            터치 없이 붙고, 그 세척기를 기억해 끊기면 다시 붙는다
//   webbt  : 크롬의 Web Bluetooth. 처음(그리고 페이지를 새로 열 때) 한 번 터치해서 세척기를 골라야 한다
//   sim    : 개발·시연용. 키보드 A/S/F 또는 화면 버튼 (주소 끝에 ?sim=1)

export const SERVICE = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHAR = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const NAME_PREFIX = 'ECOG';

// state: off(블루투스 꺼짐·권한 없음) | unsupported | need-tap(웹: 터치해서 골라야 함)
//        | connecting | connected | disconnected
class Base extends EventTarget {
  constructor() {
    super();
    this.state = 'disconnected';
    this.attempt = 0;
    this.message = '';
  }
  set(state, message = '') {
    this.state = state;
    this.message = message;
    this.dispatchEvent(new CustomEvent('state', { detail: { state, attempt: this.attempt, message } }));
  }
  emit(ch) {
    this.dispatchEvent(new CustomEvent('data', { detail: ch }));
  }
}

/** Unity 앱과 같은 재시도 간격: 바로 → 5초 → 5초 → 10초 → 10초 → (5,5,10,10 반복) */
export function retryDelay(attempt) {
  if (attempt <= 1) return 0;
  return [5, 5, 10, 10][(attempt - 2) % 4] * 1000;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, msg) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(t));
}

// ── 안드로이드 껍데기 앱 ─────────────────────────
class NativeAdapter extends Base {
  constructor() {
    super();
    this.kind = 'apk';
    this.native = window.EcogNative;
    let info = {};
    try { info = JSON.parse(this.native.info() || '{}'); } catch { /* 옛 앱 */ }
    this.version = info.appVersion || '';
    window.__ecogNative = {
      onEvent: (json) => {
        let e;
        try { e = typeof json === 'string' ? JSON.parse(json) : json; } catch { return; }
        if (e.type === 'data') for (const ch of String(e.value || '')) this.emit(ch);
        else if (e.type === 'state') { this.attempt = e.attempt || 0; this.set(e.state, e.message || ''); }
      },
    };
  }
  start() { this.native.start(); }
  reconnect() { this.native.reconnect(); }
  choose() { this.native.start(); }
  forget() { this.native.forget(); } // 기억한 세척기를 지운다. 다음 start() 때 가장 가까운 세척기를 새로 찾는다
}

// ── 크롬 Web Bluetooth ─────────────────────────
class WebBtAdapter extends Base {
  constructor() {
    super();
    this.kind = 'web';
    this.device = null;
    this.looping = false;
    this.onValue = (e) => {
      const v = e.target.value;
      for (let i = 0; i < v.byteLength; i++) this.emit(String.fromCharCode(v.getUint8(i)));
    };
    this.onDisc = () => {
      if (this.state === 'connected') this.set('disconnected');
      this.loop();
    };
  }

  async start() {
    if (!navigator.bluetooth) { this.set('unsupported', '이 브라우저는 블루투스를 쓸 수 없습니다. 안드로이드 크롬이나 eco.G 앱을 쓰세요'); return; }
    try {
      if (!(await navigator.bluetooth.getAvailability())) { this.set('off', '태블릿 블루투스를 켜 주세요'); return; }
    } catch { /* 없는 브라우저 */ }
    // 예전에 고른 세척기 (크롬 설정에 따라 지원). 없으면 터치해서 골라야 한다
    if (navigator.bluetooth.getDevices) {
      try {
        const list = await navigator.bluetooth.getDevices();
        const want = localStorage.getItem('ecog.bt.id');
        const d = list.find((x) => x.id === want) || list.find((x) => (x.name || '').startsWith(NAME_PREFIX));
        if (d) { this.use(d); this.loop(); return; }
      } catch { /* 권한 없음 */ }
    }
    this.set('need-tap');
  }

  /** 반드시 화면 터치 안에서 부른다 */
  async choose() {
    try {
      const d = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: NAME_PREFIX }], optionalServices: [SERVICE] });
      localStorage.setItem('ecog.bt.id', d.id);
      this.use(d);
      this.attempt = 0;
      this.loop();
    } catch (e) {
      this.set(this.device ? this.state : 'need-tap', e.name === 'NotFoundError' ? '세척기를 고르지 않았습니다' : e.message);
    }
  }

  use(d) {
    if (this.device && this.device !== d) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisc);
      try { this.device.gatt.disconnect(); } catch { /* 이미 끊김 */ }
    }
    this.device = d;
    d.addEventListener('gattserverdisconnected', this.onDisc);
  }

  async connectOnce() {
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    const ch = await svc.getCharacteristic(CHAR);
    ch.removeEventListener('characteristicvaluechanged', this.onValue);
    ch.addEventListener('characteristicvaluechanged', this.onValue);
    await ch.startNotifications();
  }

  async loop() {
    if (this.looping || !this.device) return;
    this.looping = true;
    try {
      while (this.device && !this.device.gatt.connected) {
        this.attempt++;
        const wait = retryDelay(this.attempt);
        for (let left = wait; left > 0; left -= 1000) {
          this.set('connecting', `${Math.ceil(left / 1000)}초 뒤 ${this.attempt}번째 연결 시도`);
          await sleep(Math.min(1000, left));
        }
        this.set('connecting', `${this.attempt}번째 연결 시도`);
        try {
          await withTimeout(this.connectOnce(), 20_000, '응답 없음');
          this.attempt = 0;
          this.set('connected');
        } catch (e) {
          try { this.device.gatt.disconnect(); } catch { /* 무시 */ }
          this.message = e.message;
        }
      }
    } finally {
      this.looping = false;
    }
  }

  reconnect() {
    if (!this.device) { this.start(); return; }
    this.attempt = 0;
    if (this.device.gatt.connected) this.device.gatt.disconnect(); // → onDisc → loop
    else this.loop();
  }

  forget() {
    localStorage.removeItem('ecog.bt.id');
    const d = this.device;
    this.device = null;
    if (d) {
      d.removeEventListener('gattserverdisconnected', this.onDisc);
      try { d.gatt.disconnect(); } catch { /* 무시 */ }
      d.forget?.().catch(() => {});
    }
    this.set('need-tap');
  }
}

// ── 시연용 ─────────────────────────
class SimAdapter extends Base {
  constructor() {
    super();
    this.kind = 'sim';
    window.addEventListener('keydown', (e) => {
      const k = e.key.toUpperCase();
      if (['A', 'S', 'F', 'N'].includes(k) && !e.target.closest?.('input')) this.emit(k);
    });
  }
  start() { this.set('connected'); this.hb = setInterval(() => this.emit('N'), 1000); }
  reconnect() { this.set('connected'); }
  choose() { this.set('connected'); }
  forget() {}
}

export function createAdapter() {
  if (new URLSearchParams(location.search).has('sim')) return new SimAdapter();
  if (window.EcogNative) return new NativeAdapter();
  return new WebBtAdapter();
}
