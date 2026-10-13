package com.njg.clouddupecleaner

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.browser.customtabs.CustomTabsIntent
import java.text.DateFormat
import java.util.Date

class MainActivity : Activity() {
    private val library = MockLibrary()
    private val connected = linkedSetOf<String>()
    private var groups: List<DuplicateGroup> = emptyList()
    private var keeperId: String = ""
    private lateinit var tokenStore: TokenStore
    private var dark = true

    override fun onCreate(savedInstanceState: Bundle?) {
        dark = getSharedPreferences(UI_PREFS, MODE_PRIVATE).getBoolean("dark", true)
        setTheme(if (dark) R.style.Theme_CloudDupe else R.style.Theme_CloudDupe_Light)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tokenStore = openStore()
        PROVIDERS.forEach { (id, _) ->
            if (tokenStore.get("token.$id") != null) connected.add(id)
        }
        findViewById<Button>(R.id.theme_toggle).apply {
            text = if (dark) "Light" else "Dark"
            setOnClickListener {
                getSharedPreferences(UI_PREFS, MODE_PRIVATE).edit().putBoolean("dark", !dark).apply()
                recreate()
            }
        }
        renderProviders()
        findViewById<Button>(R.id.scan).setOnClickListener { scan() }
    }

    private fun ink() = if (dark) 0xFFEEF3EF.toInt() else 0xFF1D1A16.toInt()
    private fun muted() = if (dark) 0xFFA3B5AA.toInt() else 0xFF5E584F.toInt()
    private fun card() = if (dark) 0xFF1C2420.toInt() else 0xFFFFFDF8.toInt()
    private fun accent() = if (dark) 0xFFB6D98A.toInt() else 0xFF1F7A4D.toInt()

    private fun openStore(): TokenStore {
        return try {
            SecureTokenStore.open(this)
        } catch (_: Exception) {
            findViewById<TextView>(R.id.summary).text =
                "Secure storage is unavailable. Demo tokens stay in memory for this session only."
            MemoryTokenStore()
        }
    }

    private fun renderProviders() {
        val host = findViewById<LinearLayout>(R.id.providers)
        host.removeAllViews()
        PROVIDERS.forEach { (id, label) ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            val name = TextView(this).apply {
                text = if (id in connected) "$label · connected" else label
                setTextColor(ink())
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val action = Button(this).apply {
                text = if (id in connected) "Disconnect" else "Connect sample"
                setOnClickListener { if (id in connected) disconnect(id) else connect(id) }
            }
            row.addView(name)
            row.addView(action)
            host.addView(row)
        }
    }

    private fun connect(provider: String) {
        val clientId = clientId(provider)
        if (clientId.isNotEmpty()) {
            val pkce = Pkce.create()
            val state = Pkce.create().verifier
            tokenStore.put("oauth_state", state)
            tokenStore.put("oauth_verifier", pkce.verifier)
            val redirect = "clouddupecleaner://oauth"
            val scopes = when (provider) {
                "dropbox" -> listOf("files.metadata.read", "files.content.read")
                "onedrive" -> listOf("Files.Read", "offline_access")
                "gdrive" -> listOf("https://www.googleapis.com/auth/drive.readonly")
                else -> listOf("https://www.googleapis.com/auth/photoslibrary.readonly")
            }
            val url = AuthorizeUrl.build(provider, clientId, redirect, state, pkce.challenge, scopes)
            CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
            return
        }
        tokenStore.put("token.$provider", "mock-access.$provider")
        connected.add(provider)
        renderProviders()
        findViewById<TextView>(R.id.summary).text = "Sample account connected. Tokens are not in plaintext storage."
    }

    private fun disconnect(provider: String) {
        tokenStore.delete("token.$provider")
        connected.remove(provider)
        groups = emptyList()
        findViewById<LinearLayout>(R.id.results).removeAllViews()
        renderProviders()
    }

    private fun scan() {
        val names = PROVIDERS.filter { it.first in connected }
        val progress = findViewById<ProgressBar>(R.id.progress)
        val label = findViewById<TextView>(R.id.progress_label)
        progress.visibility = View.VISIBLE
        label.visibility = View.VISIBLE
        progress.progress = 5
        label.text = "Starting scan…"
        label.setTextColor(muted())
        if (names.isEmpty()) {
            progress.visibility = View.GONE
            label.visibility = View.GONE
            return
        }
        var index = 0
        val step = object : Runnable {
            override fun run() {
                if (index < names.size) {
                    progress.progress = ((index + 1) * 80 / names.size)
                    label.text = "Scanning ${names[index].second}…"
                    index += 1
                    progress.postDelayed(this, 180)
                } else {
                    label.text = "Grouping duplicates…"
                    progress.progress = 100
                    finishScan()
                    progress.postDelayed({
                        progress.visibility = View.GONE
                        label.visibility = View.GONE
                    }, 250)
                }
            }
        }
        progress.post(step)
    }

    private fun finishScan() {
        val files = library.files.filter { it.provider in connected }
        groups = DuplicateFinder.find(files)
        val wasted = groups.sumOf { it.wastedBytes ?: 0L }
        val summary = findViewById<TextView>(R.id.summary)
        summary.setTextColor(ink())
        summary.text = if (groups.isEmpty()) {
            "No duplicate groups in the connected sample accounts."
        } else {
            "Space that can move to trash: ${formatBytes(wasted)}\n${groups.size} groups. Open one to keep a copy."
        }
        val host = findViewById<LinearLayout>(R.id.results)
        host.removeAllViews()
        groups.forEach { group ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundColor(card())
                setPadding(24, 24, 24, 24)
                val gap = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                gap.topMargin = 24
                layoutParams = gap
            }
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            group.files.take(2).forEach { file ->
                row.addView(preview(file, 280))
            }
            val title = TextView(this).apply {
                text = "${group.count} copies · ${formatBytes(group.wastedBytes)} extra"
                setTextColor(ink())
                textSize = 18f
                setPadding(0, 16, 0, 0)
            }
            val badge = TextView(this).apply {
                text = if (group.match == "content") "Content hash" else "Name and size only"
                setTextColor(accent())
            }
            card.addView(row)
            card.addView(title)
            card.addView(badge)
            card.setOnClickListener { openCompare(group) }
            host.addView(card)
        }
    }

    private fun preview(file: CloudFile, size: Int): View {
        val res = when (file.sampleKey) {
            "holiday" -> R.drawable.sample_holiday
            "camera" -> R.drawable.sample_camera
            else -> 0
        }
        if (file.kind == "image" && res != 0) {
            return ImageView(this).apply {
                setImageResource(res)
                scaleType = ImageView.ScaleType.CENTER_CROP
                layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = 12 }
                contentDescription = file.name
            }
        }
        return TextView(this).apply {
            text = when (file.kind) {
                "pdf" -> "PDF"
                "sheet" -> "SHEET"
                "text" -> "TEXT"
                "video" -> "VIDEO"
                else -> "FILE"
            }
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(muted())
            setBackgroundColor(if (dark) 0xFF24302A.toInt() else 0xFFEFE8DA.toInt())
            layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = 12 }
        }
    }

    private fun openCompare(group: DuplicateGroup) {
        val keeper = group.files.firstOrNull { it.trashable } ?: group.files.first()
        keeperId = keeper.id
        val body = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
            setPadding(8, 8, 8, 8)
        }
        group.files.forEach { file ->
            body.addView(preview(file, 0).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 360)
            })
            body.addView(TextView(this).apply {
                text = "${file.name}\n${providerLabel(file.provider)} · ${formatBytes(file.size)}\n${formatDate(file.modifiedAt)}\n${file.path}"
                setTextColor(ink())
                setPadding(0, 8, 0, 4)
            })
            if (!file.trashable) {
                body.addView(TextView(this).apply {
                    text = "No trash API"
                    setTextColor(0xFFC45D78.toInt())
                })
            }
            body.addView(RadioButton(this).apply {
                id = View.generateViewId()
                text = "Keep this one"
                tag = file.id
                isChecked = file.id == keeperId
                setTextColor(ink())
            })
        }
        body.setOnCheckedChangeListener { groupView, checkedId ->
            val selected = groupView.findViewById<RadioButton>(checkedId)
            keeperId = selected?.tag as? String ?: keeperId
        }
        AlertDialog.Builder(this)
            .setTitle(if (group.match == "content") "Same content hash" else "Name and size only")
            .setView(body)
            .setNegativeButton("Close", null)
            .setNeutralButton("Review Photos") { _, _ ->
                val photos = group.files.filter { it.provider == "gphotos" }
                if (photos.isNotEmpty()) confirmAlbum(photos)
            }
            .setPositiveButton("Move other copies to trash") { _, _ ->
                val extras = group.files.filter { it.trashable && it.id != keeperId }.map { it.id }
                if (extras.isEmpty() || extras.size >= group.files.size) {
                    findViewById<TextView>(R.id.summary).text = "Leave at least one copy in the group."
                } else {
                    confirmTrash(group, extras)
                }
            }
            .show()
    }

    private fun confirmTrash(group: DuplicateGroup, selected: List<String>) {
        val names = group.files.filter { it.id in selected }.joinToString("\n") { "${it.name} · ${it.path}" }
        AlertDialog.Builder(this)
            .setTitle("Move ${selected.size} files to trash?")
            .setMessage("${getString(R.string.trash_message)}\n\n$names")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Move to trash") { _, _ ->
                val planned = TrashPolicy.plan(groups, selected, TrashPolicy.TRASH_CONFIRMATION)
                planned.forEach { library.trash(it) }
                finishScan()
                findViewById<TextView>(R.id.summary).text =
                    "Moved ${planned.size} files to trash. The copy you kept is still there."
            }
            .show()
    }

    private fun confirmAlbum(photos: List<CloudFile>) {
        val steps = TrashPolicy.photosManualSteps.joinToString("\n")
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.photos_title))
            .setMessage("$steps\n\nFiles: ${photos.joinToString { it.name }}")
            .setNegativeButton("Close", null)
            .setPositiveButton("Add to review album") { _, _ ->
                library.addToReviewAlbum(photos)
                findViewById<TextView>(R.id.summary).text =
                    "Added to “Duplicate review”. The album does not delete anything."
            }
            .show()
    }

    private fun providerLabel(id: String) = PROVIDERS.find { it.first == id }?.second ?: id

    private fun formatBytes(bytes: Long?): String {
        if (bytes == null) return "Size unknown"
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return String.format("%.1f KB", kb)
        return String.format("%.1f MB", kb / 1024.0)
    }

    private fun formatDate(iso: String?): String {
        if (iso.isNullOrBlank()) return "Date unknown"
        return try {
            val time = java.time.Instant.parse(iso).toEpochMilli()
            DateFormat.getDateInstance().format(Date(time))
        } catch (_: Exception) {
            iso
        }
    }

    private fun clientId(provider: String): String {
        return when (provider) {
            "dropbox" -> BuildConfig.DROPBOX_CLIENT_ID
            "onedrive" -> BuildConfig.ONEDRIVE_CLIENT_ID
            else -> BuildConfig.GOOGLE_CLIENT_ID
        }
    }

    companion object {
        private const val UI_PREFS = "ui_prefs"
        val PROVIDERS = listOf(
            "dropbox" to "Dropbox",
            "onedrive" to "OneDrive",
            "gdrive" to "Google Drive",
            "gphotos" to "Google Photos",
        )
    }
}
