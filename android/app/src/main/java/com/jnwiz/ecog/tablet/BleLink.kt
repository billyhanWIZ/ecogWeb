package com.jnwiz.ecog.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.UUID

/**
 * 세척 신호 송신부(ESP32, 이름 'ECOG')와의 블루투스 연결.
 * - 6초 동안 찾아서 신호가 가장 센(가까운) ECOG 에 붙고, 그 주소를 기억한다.
 * - 끊기면 기억한 세척기를 다시 찾아 붙는다. 재시도 간격은 Unity 앱과 같다(바로, 5, 5, 10, 10초 반복).
 * - 기억한 세척기가 1분 넘게 안 보이면 그때 가장 가까운 ECOG 로 바꾼다 (세척기를 바꾼 경우).
 * - 받은 글자(N/A/S/F)와 상태는 emit 으로 웹 화면에 넘긴다.
 * 모든 상태 변경은 메인 스레드에서 한다. gen 값이 바뀌면 이전 시도의 콜백·타이머는 무시된다.
 */
@SuppressLint("MissingPermission") // 권한은 ready() 에서 확인한다
class BleLink(private val ctx: Context, private val emit: (String) -> Unit) {
    companion object {
        val SERVICE: UUID = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
        val CHAR: UUID = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val PREFIX = "ECOG"
        const val SCAN_MS = 6_000L
        const val CONNECT_TIMEOUT_MS = 20_000L
        const val SWITCH_AFTER_ATTEMPTS = 6
    }

    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("ble", Context.MODE_PRIVATE)
    private val manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
    private val adapter get() = manager?.adapter

    private var gatt: BluetoothGatt? = null
    private var scanCb: ScanCallback? = null
    private var running = false
    private var gen = 0
    private var attempt = 0
    private var state = "disconnected"
    private var message = ""
    private val found = HashMap<String, Int>()

    val savedAddress: String? get() = prefs.getString("address", null)

    fun start() {
        if (running) { emitState(); return } // 화면을 새로 열었을 때: 지금 상태만 다시 알려 준다
        running = true
        attempt = 0
        next()
    }

    fun reconnect() {
        running = true
        attempt = 0
        stopScan()
        closeGatt()
        next()
    }

    /** 기억한 세척기를 지우고 가장 가까운 세척기를 새로 찾는다 */
    fun forget() {
        prefs.edit().remove("address").apply()
        reconnect()
    }

    fun close() {
        running = false
        gen++
        stopScan()
        closeGatt()
    }

    /** 권한·블루투스가 바뀌었을 때 (설정에서 돌아옴 등) */
    fun poke() {
        if (running && state == "off") { attempt = 0; next() }
    }

    // ── 재시도 ─────────────
    private fun retryDelay(n: Int): Int = if (n <= 1) 0 else intArrayOf(5, 5, 10, 10)[(n - 2) % 4]

    private fun next() {
        val g = ++gen
        attempt++
        countdown(g, retryDelay(attempt))
    }

    private fun countdown(g: Int, left: Int) {
        if (g != gen) return
        if (left <= 0) { tryOnce(g); return }
        set("connecting", "${left}초 뒤 ${attempt}번째 연결 시도")
        main.postDelayed({ countdown(g, left - 1) }, 1000)
    }

    private fun tryOnce(g: Int) {
        if (g != gen || !running) return
        val err = ready()
        if (err != null) {
            set("off", err)
            main.postDelayed({ tryOnce(g) }, 5000)
            return
        }
        set("connecting", "${attempt}번째 연결 시도 · 세척기를 찾는 중")
        scan(g)
    }

    private fun fail(g: Int, msg: String) {
        if (g != gen) return
        stopScan()
        closeGatt()
        set(if (state == "connected") "disconnected" else "connecting", msg)
        if (running) next()
    }

    // ── 찾기 ─────────────
    private fun scan(g: Int) {
        val scanner = adapter?.bluetoothLeScanner ?: return fail(g, "블루투스를 쓸 수 없습니다")
        found.clear()
        val saved = savedAddress
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                main.post { onFound(g, saved, result) }
            }
            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                main.post { results.forEach { onFound(g, saved, it) } }
            }
            override fun onScanFailed(errorCode: Int) {
                main.post { scanCb = null; fail(g, "블루투스 찾기 실패 ($errorCode)") }
            }
        }
        scanCb = cb
        try {
            scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb)
        } catch (e: Exception) {
            scanCb = null
            return fail(g, "블루투스 찾기 실패 (${e.message})")
        }
        main.postDelayed({ if (g == gen && scanCb === cb) finishScan(g, saved) }, SCAN_MS)
    }

    private fun onFound(g: Int, saved: String?, r: ScanResult) {
        if (g != gen || scanCb == null) return
        val name = r.scanRecord?.deviceName ?: safeName(r.device)
        if (name == null || !name.startsWith(PREFIX)) return
        val addr = r.device.address
        found[addr] = maxOf(found[addr] ?: Int.MIN_VALUE, r.rssi)
        if (addr == saved) { // 기억한 세척기는 보이면 바로
            stopScan()
            connect(g, r.device)
        }
    }

    private fun finishScan(g: Int, saved: String?) {
        stopScan()
        if (found.isEmpty()) return fail(g, "세척기를 찾지 못했습니다. 세척기 전원을 확인하세요")
        if (saved != null && attempt < SWITCH_AFTER_ATTEMPTS) {
            return fail(g, "연결했던 세척기가 보이지 않습니다")
        }
        val best = found.maxByOrNull { it.value }!!.key // 신호가 가장 센 = 가장 가까운 세척기
        val dev = adapter?.getRemoteDevice(best) ?: return fail(g, "블루투스를 쓸 수 없습니다")
        connect(g, dev)
    }

    private fun safeName(d: BluetoothDevice): String? = try { d.name } catch (e: SecurityException) { null }

    // ── 연결 ─────────────
    private fun connect(g: Int, device: BluetoothDevice) {
        set("connecting", "세척기에 연결하는 중")
        closeGatt()
        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gt: BluetoothGatt, status: Int, newState: Int) {
                main.post {
                    if (g != gen) { gt.close(); return@post }
                    if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                        // ESP32 는 붙은 직후 바로 묻으면 가끔 놓친다 (Unity 앱도 잠시 기다렸다 구독)
                        main.postDelayed({ if (g == gen) gt.discoverServices() }, 600)
                    } else {
                        fail(g, if (state == "connected") "세척기 연결이 끊겼습니다" else "연결 실패 ($status)")
                    }
                }
            }

            override fun onServicesDiscovered(gt: BluetoothGatt, status: Int) {
                main.post {
                    if (g != gen) return@post
                    val ch = gt.getService(SERVICE)?.getCharacteristic(CHAR)
                        ?: return@post fail(g, "세척기 신호 항목을 찾지 못했습니다")
                    gt.setCharacteristicNotification(ch, true)
                    val desc = ch.getDescriptor(CCCD)
                    if (desc == null) { connected(g, gt.device.address); return@post }
                    if (!enableNotify(gt, desc)) fail(g, "세척기 신호 받기 설정 실패")
                }
            }

            override fun onDescriptorWrite(gt: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
                main.post {
                    if (g != gen) return@post
                    if (status == BluetoothGatt.GATT_SUCCESS) connected(g, gt.device.address)
                    else fail(g, "세척기 신호 받기 설정 실패 ($status)")
                }
            }

            // 안드로이드 13 이상
            override fun onCharacteristicChanged(gt: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
                if (c.uuid == CHAR) data(g, value)
            }

            // 안드로이드 12 이하
            @Deprecated("Deprecated in Java")
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gt: BluetoothGatt, c: BluetoothGattCharacteristic) {
                if (Build.VERSION.SDK_INT >= 33) return
                val v = c.value ?: return
                if (c.uuid == CHAR) data(g, v)
            }
        }
        gatt = device.connectGatt(ctx, false, cb, BluetoothDevice.TRANSPORT_LE)
        main.postDelayed({ if (g == gen && state != "connected") fail(g, "세척기가 응답하지 않습니다") }, CONNECT_TIMEOUT_MS)
    }

    @Suppress("DEPRECATION")
    private fun enableNotify(gt: BluetoothGatt, desc: BluetoothGattDescriptor): Boolean {
        if (Build.VERSION.SDK_INT >= 33) {
            return gt.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == 0
        }
        desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        return gt.writeDescriptor(desc)
    }

    private fun connected(g: Int, address: String) {
        if (g != gen) return
        prefs.edit().putString("address", address).apply()
        attempt = 0
        set("connected", "")
    }

    private fun data(g: Int, bytes: ByteArray) {
        val s = String(bytes, Charsets.US_ASCII)
        main.post {
            if (g != gen) return@post
            emit(JSONObject().put("type", "data").put("value", s).toString())
        }
    }

    private fun stopScan() {
        val cb = scanCb ?: return
        scanCb = null
        try { adapter?.bluetoothLeScanner?.stopScan(cb) } catch (e: Exception) { /* 이미 멈춤 */ }
    }

    private fun closeGatt() {
        val g = gatt ?: return
        gatt = null
        try { g.disconnect() } catch (e: Exception) { /* 무시 */ }
        try { g.close() } catch (e: Exception) { /* 무시 */ }
    }

    // ── 준비 확인 ─────────────
    private fun has(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    /** 문제가 있으면 화면에 보여 줄 문구, 없으면 null */
    private fun ready(): String? {
        val a = adapter ?: return "블루투스가 없는 기기입니다"
        if (Build.VERSION.SDK_INT >= 31) {
            if (!has(Manifest.permission.BLUETOOTH_SCAN) || !has(Manifest.permission.BLUETOOTH_CONNECT)) return "블루투스 권한(근처 기기)을 허용해 주세요"
        } else if (!has(Manifest.permission.ACCESS_FINE_LOCATION)) {
            return "블루투스 찾기에 필요한 위치 권한을 허용해 주세요"
        }
        if (!a.isEnabled) return "태블릿 블루투스를 켜 주세요"
        if (Build.VERSION.SDK_INT < 31) {
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager?
            val on = lm != null && (lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
            if (!on) return "태블릿 위치(GPS)를 켜 주세요 (안드로이드 11 이하는 블루투스 찾기에 필요)"
        }
        return null
    }

    private fun set(s: String, msg: String) {
        state = s
        message = msg
        emitState()
    }

    fun emitState() {
        emit(JSONObject().put("type", "state").put("state", state).put("attempt", attempt).put("message", message).toString())
    }
}
