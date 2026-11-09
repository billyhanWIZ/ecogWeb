package com.jnwiz.ecog.tablet

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * 세척기 태블릿 껍데기: 웹 화면(/t)을 전체 화면으로 띄우고, 블루투스는 BleLink 가 맡는다.
 * 웹 화면은 window.EcogNative(아래 Bridge)로 앱을 부르고, 앱은 window.__ecogNative.onEvent(json)로 알린다.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var ble: BleLink
    private val main = Handler(Looper.getMainLooper())
    private var retry: Runnable? = null

    private val btReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) { ble.poke() } // 블루투스를 켜면 바로 다시 찾는다
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#134226"))
        setContentView(web)
        hideBars()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // 등록 토큰·보내지 못한 세척 기록
            mediaPlaybackRequiresUserGesture = false // 세척 영상 소리
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString EcogTablet/${BuildConfig.VERSION_NAME}"
        }
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                return request.url.host != BuildConfig.ECOG_HOST // 다른 사이트로는 가지 않는다
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame) showOffline(error.description?.toString() ?: "")
            }

            // 안드로이드 5.1
            @Deprecated("Deprecated in Java")
            override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
                if (Build.VERSION.SDK_INT < 23) showOffline(description ?: "")
            }
        }

        ble = BleLink(this) { json -> send(json) }
        web.addJavascriptInterface(Bridge(), "EcogNative")
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(btReceiver, filter, Context.RECEIVER_EXPORTED)
        else registerReceiver(btReceiver, filter)

        web.loadUrl(BuildConfig.ECOG_URL)
        askPermissions()
    }

    /** 앱 → 웹 */
    private fun send(json: String) {
        main.post { web.evaluateJavascript("window.__ecogNative&&window.__ecogNative.onEvent(${JSONObject.quote(json)})", null) }
    }

    inner class Bridge {
        @JavascriptInterface
        fun info(): String = JSONObject()
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("android", Build.VERSION.SDK_INT)
            .put("model", Build.MODEL)
            .put("saved", ble.savedAddress ?: JSONObject.NULL)
            .toString()

        @JavascriptInterface fun start() { main.post { ble.start() } }
        @JavascriptInterface fun reconnect() { main.post { ble.reconnect() } }
        @JavascriptInterface fun forget() { main.post { ble.forget() } }
        @JavascriptInterface fun openSystemSettings() { main.post { startActivity(Intent(Settings.ACTION_SETTINGS)) } }
        @JavascriptInterface fun exit() { main.post { exitApp() } }
    }

    /**
     * 앱 종료. 이 앱이 홈 앱으로 지정돼 있으면 닫아도 안드로이드가 곧바로 다시 띄우므로,
     * 그때는 안드로이드 설정으로 나간다 (홈 앱을 바꾸거나 다른 작업을 할 수 있게).
     */
    private fun exitApp() {
        if (isDefaultHome()) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
            return
        }
        ble.close()
        finishAndRemoveTask()
    }

    private fun isDefaultHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val info = packageManager.resolveActivity(home, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
        return info?.activityInfo?.packageName == packageName
    }

    // ── 인터넷이 없을 때 ─────────────
    private fun showOffline(reason: String) {
        val html = """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
              background:#134226;color:#fff;font-family:sans-serif;text-align:center">
              <h1 style="font-size:5vmin;margin:0 0 2vmin">인터넷에 연결하는 중</h1>
              <p style="font-size:2.6vmin;color:#DDEBDD;margin:0">와이파이를 확인하세요. 15초마다 다시 시도합니다.</p>
              <p style="font-size:1.8vmin;color:#9fb8a3">${reason.replace("<", "")}</p>
            </body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        retry?.let { main.removeCallbacks(it) }
        val r = Runnable { web.loadUrl(BuildConfig.ECOG_URL) }
        retry = r
        main.postDelayed(r, 15_000)
    }

    // ── 권한 ─────────────
    private fun askPermissions() {
        if (Build.VERSION.SDK_INT < 23) { afterPermissions(); return } // 5.1 은 설치 때 이미 허용
        val need = if (Build.VERSION.SDK_INT >= 31) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        }
        val missing = need.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
        else afterPermissions()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        afterPermissions()
    }

    private fun afterPermissions() {
        ble.poke()
        // 블루투스가 꺼져 있으면 켜 달라고 묻는다
        try {
            val canAsk = Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager?)?.adapter
            if (canAsk && adapter != null && !adapter.isEnabled) startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
        } catch (e: Exception) { /* 무시 */ }
        // 재부팅 뒤 스스로 켜지려면 '다른 앱 위에 표시' 권한이 필요하다 (안드로이드 10 이상). 한 번만 묻는다
        val prefs = getSharedPreferences("app", Context.MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= 29 && !Settings.canDrawOverlays(this) && !prefs.getBoolean("askedOverlay", false)) {
            prefs.edit().putBoolean("askedOverlay", true).apply()
            try {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            } catch (e: Exception) { /* 없는 기기 */ }
        }
    }

    // ── 화면 ─────────────
    @Suppress("DEPRECATION")
    private fun hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideBars()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        ble.poke() // 설정에서 권한·블루투스를 켜고 돌아온 경우
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    @Deprecated("Deprecated in Java")
    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        // 키오스크: 뒤로 가기로 앱이 닫히지 않게 한다
    }

    override fun onDestroy() {
        try { unregisterReceiver(btReceiver) } catch (e: Exception) { /* 무시 */ }
        ble.close()
        web.destroy()
        super.onDestroy()
    }
}
