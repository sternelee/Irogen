package com.clawdpilot.dev

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Foreground service to keep ClawdPilot running in background
 * and display agent status (thinking, permissions, etc.) in notification
 */
class AgentForegroundService : Service() {
    private val notificationManager by lazy {
        getSystemService(NotificationManager::class.java)
    }
    private var foregroundStarted = false
    private var currentSessionId: String? = null
    private var currentAgentType: String = "Agent"

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPSERT -> {
                val payload = intent.getStringExtra(EXTRA_PAYLOAD)
                val status = payload?.let { AgentStatus.fromJson(it) }
                if (status == null) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    return START_NOT_STICKY
                }

                currentSessionId = status.sessionId
                currentAgentType = status.agentType

                val notification = buildNotification(status)
                if (!foregroundStarted) {
                    foregroundStarted = true
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(
                            NOTIFICATION_ID,
                            notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                                ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
                } else {
                    notificationManager.notify(NOTIFICATION_ID, notification)
                }
            }

            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                foregroundStarted = false
                currentSessionId = null
                stopSelf()
            }
        }

        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        foregroundStarted = false
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.foreground_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.foreground_channel_description)
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        notificationManager.createNotificationChannel(channel)
    }

    private fun buildNotification(status: AgentStatus): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: Intent(this, MainActivity::class.java)

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
        )

        val stateLabel = when (status.state) {
            "thinking" -> "Thinking"
            "tool_call" -> "Running Tool"
            "permission_requested" -> "Permission Required"
            "responding" -> "Responding"
            "idle" -> "Ready"
            "error" -> "Error"
            else -> "Running"
        }

        val contentText = buildString {
            append(stateLabel)
            if (status.details.isNotBlank()) {
                append(" · ")
                append(status.details)
            }
        }

        val bigText = buildString {
            append(contentText)
            if (status.toolName.isNotBlank()) {
                append("\nTool: ")
                append(status.toolName)
            }
            if (status.message.isNotBlank()) {
                append("\n")
                append(status.message)
            }
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("${currentAgentType} · ${status.sessionId.take(8)}")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .build()
    }

    private fun pendingIntentImmutableFlag(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE
        } else {
            0
        }
    }

    /**
     * Represents the current agent status for notification display
     */
    data class AgentStatus(
        val sessionId: String,
        val agentType: String,
        val state: String,
        val details: String,
        val toolName: String,
        val message: String
    ) {
        companion object {
            fun fromJson(json: String): AgentStatus? {
                return runCatching {
                    val obj = JSONObject(json)
                    AgentStatus(
                        sessionId = obj.optString("sessionId", "unknown"),
                        agentType = obj.optString("agentType", "Agent"),
                        state = obj.optString("state", "idle"),
                        details = obj.optString("details", ""),
                        toolName = obj.optString("toolName", ""),
                        message = obj.optString("message", "")
                    )
                }.getOrNull()
            }
        }
    }

    companion object {
        private const val CHANNEL_ID = "clawdpilot-agent"
        private const val NOTIFICATION_ID = 2001
        private const val ACTION_UPSERT = "com.clawdpilot.dev.action.UPSERT_FOREGROUND"
        private const val ACTION_STOP = "com.clawdpilot.dev.action.STOP_FOREGROUND"
        private const val EXTRA_PAYLOAD = "payload"

        /**
         * Update or create the foreground service notification
         */
        fun upsert(context: Context, payloadJson: String) {
            val intent = Intent(context, AgentForegroundService::class.java).apply {
                action = ACTION_UPSERT
                putExtra(EXTRA_PAYLOAD, payloadJson)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        /**
         * Stop the foreground service
         */
        fun stop(context: Context) {
            val intent = Intent(context, AgentForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
