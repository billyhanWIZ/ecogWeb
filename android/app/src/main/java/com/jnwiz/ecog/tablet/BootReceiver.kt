package com.jnwiz.ecog.tablet

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 태블릿이 켜지면 화면을 띄운다 (안드로이드 10 이상은 '다른 앱 위에 표시' 권한이나 홈 앱 지정이 필요) */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
