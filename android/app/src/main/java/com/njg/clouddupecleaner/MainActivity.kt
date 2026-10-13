package com.njg.clouddupecleaner

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val library = MockLibrary()
    private val connected = linkedSetOf<String>()
    private var groups: List<DuplicateGroup> = emptyList()
    private var keeperId: String = ""
    private lateinit var tokenStore: TokenStore
    private lateinit var cloud: CloudClient
    private var dark = true
    private var secureStore = true
    private var scanning = false
    private val lastFiles = mutableListOf<CloudFile>()
    private val thumbCache = LruCache<String, Bitmap>(32)
    private val work = Executors.newSingleThreadExecutor()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        dark = getSharedPreferences(UI_PREFS, MODE_PRIVATE).getBoolean("dark", true)
        setTheme(if (dark) R.style.Theme_CloudDupe else R.style.Theme_CloudDupe_Light)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tokenStore = openStore()
        cloud = CloudClient(tokenStore, BuildConfig.DROPBOX_CLIENT_ID, BuildConfig.GOOGLE_CLIENT_ID)
        findViewById<TextView>(R.id.version).text = getString(R.string.app_name) + " " + BuildConfig.VERSION_NAME
        findViewById<TextView>(R.id.setup).visibility = if (needsSetupNote()) View.VISIBLE else View.GONE
        findViewById<Button>(R.id.theme_toggle).apply {
            text = if (dark) getString(R.string.theme_light) else getString(R.string.theme_dark)
            contentDescription = getString(R.string.theme_toggle)
            setOnClickListener {
                getSharedPreferences(UI_PREFS, MODE_PRIVATE).edit().putBoolean("dark", !dark).apply()
                recreate()
            }
        }
        reloadConnected()
        renderProviders()
        showEmpty(getString(if (sampleMode()) R.string.empty_connect else R.string.empty_connect_live))
        findViewById<Button>(R.id.scan).setOnClickListener { scan() }
        watchNetwork()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (!::tokenStore.isInitialized) return
        reloadConnected()
        renderProviders()
        val resume = tokenStore.get("oauth_resume") ?: return
        tokenStore.delete("oauth_resume")
        if (resume == "trash") continuePendingTrash()
    }

    override fun onDestroy() {
        networkCallback?.let {
            val manager = getSystemService(ConnectivityManager::class.java)
            manager.unregisterNetworkCallback(it)
        }
        super.onDestroy()
    }

    private fun sampleMode(): Boolean {
        return BuildConfig.DROPBOX_CLIENT_ID.isEmpty() && BuildConfig.GOOGLE_CLIENT_ID.isEmpty()
    }

    private fun needsSetupNote(): Boolean {
        return BuildConfig.DROPBOX_CLIENT_ID.isEmpty() || BuildConfig.GOOGLE_CLIENT_ID.isEmpty()
    }

    private fun reloadConnected() {
        connected.clear()
        PROVIDERS.forEach { (id, _) ->
            if (tokenStore.get("token.$id") != null) connected.add(id)
        }
    }

    private fun onUi(block: () -> Unit) {
        if (isDestroyed) return
        runOnUiThread {
            if (!isDestroyed) block()
        }
    }

    private fun watchNetwork() {
        val manager = getSystemService(ConnectivityManager::class.java)
        val banner = findViewById<TextView>(R.id.offline)
        fun update(online: Boolean) {
            banner.visibility = if (online) View.GONE else View.VISIBLE
        }
        update(isOnline(manager))
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = runOnUiThread { update(true) }
            override fun onLost(network: Network) = runOnUiThread { update(isOnline(manager)) }
        }
        networkCallback = callback
        manager.registerDefaultNetworkCallback(callback)
    }

    private fun isOnline(manager: ConnectivityManager): Boolean {
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun showError(message: String) {
        findViewById<TextView>(R.id.error_banner).apply {
            text = message
            visibility = View.VISIBLE
        }
    }

    private fun clearError() {
        findViewById<TextView>(R.id.error_banner).visibility = View.GONE
    }

    private fun showEmpty(message: String) {
        findViewById<TextView>(R.id.empty_state).apply {
            text = message
            visibility = View.VISIBLE
        }
    }

    private fun hideEmpty() {
        findViewById<TextView>(R.id.empty_state).visibility = View.GONE
    }

    private fun openStore(): TokenStore {
        return try {
            SecureTokenStore.open(this)
        } catch (_: Exception) {
            secureStore = false
            showError(getString(R.string.secure_storage_unavailable))
            MemoryTokenStore()
        }
    }

    private fun isMock(provider: String): Boolean {
        return tokenStore.get("token.$provider")?.startsWith("mock-access.") == true
    }

    private fun isLive(provider: String): Boolean {
        return provider in connected && !isMock(provider) && (provider == "dropbox" || provider == "gdrive")
    }

    private fun needsTrashAuth(provider: String): Boolean {
        if (isMock(provider)) return false
        val required = ProviderScopes.trashScope(provider)
        if (required.isEmpty()) return false
        val granted = tokenStore.get("scopes.$provider").orEmpty().split(Regex("\\s+"))
        return required !in granted
    }

    private fun renderProviders() {
        val host = findViewById<LinearLayout>(R.id.providers)
        host.removeAllViews()
        PROVIDERS.forEach { (id, label) ->
            val row = layoutInflater.inflate(R.layout.item_provider, host, false)
            row.findViewById<TextView>(R.id.provider_name).text = label
            val status = row.findViewById<TextView>(R.id.provider_status)
            val action = row.findViewById<Button>(R.id.provider_action)
            if (id == "onedrive") {
                status.text = getString(R.string.coming_soon)
                action.text = getString(R.string.coming_soon)
                action.isEnabled = false
            } else {
                status.text = if (id in connected) getString(R.string.connected) else getString(R.string.not_connected)
                val live = clientId(id).isNotEmpty()
                action.text = when {
                    id in connected -> getString(R.string.disconnect)
                    live -> getString(R.string.connect)
                    else -> getString(R.string.connect_sample)
                }
                action.setOnClickListener { if (id in connected) disconnect(id) else connect(id) }
            }
            action.contentDescription = action.text.toString() + " " + label
            host.addView(row)
        }
    }

    private fun connect(provider: String) {
        clearError()
        if (provider == "onedrive") return
        if (provider == "gphotos" || clientId(provider).isEmpty()) {
            tokenStore.put("token.$provider", "mock-access.$provider")
            connected.add(provider)
            renderProviders()
            return
        }
        startOAuth(provider, "connect")
    }

    private fun startOAuth(provider: String, purpose: String) {
        if (!secureStore) {
            showError(getString(R.string.secure_storage_unavailable))
            return
        }
        if (findViewById<TextView>(R.id.offline).visibility == View.VISIBLE) {
            showError(getString(R.string.offline))
            return
        }
        val id = clientId(provider)
        if (id.isEmpty() || (provider != "dropbox" && provider != "gdrive")) return
        val redirect = if (provider == "dropbox") BuildConfig.DROPBOX_REDIRECT_URI else BuildConfig.GOOGLE_REDIRECT_URI
        val allow = listOf(BuildConfig.DROPBOX_REDIRECT_URI, BuildConfig.GOOGLE_REDIRECT_URI).filter { it.isNotEmpty() }
        val normalized = try {
            Redirects.normalize(redirect, allow)
        } catch (error: PolicyException) {
            showError(error.message ?: getString(R.string.signin_failed))
            return
        }
        val pkce = Pkce.create()
        val state = Pkce.create().verifier
        val scopes = if (purpose == "trash") ProviderScopes.trash(provider) else ProviderScopes.connect(provider)
        tokenStore.put("oauth_state", state)
        tokenStore.put("oauth_verifier", pkce.verifier)
        tokenStore.put("oauth_provider", provider)
        tokenStore.put("oauth_redirect", normalized)
        tokenStore.put("oauth_purpose", purpose)
        tokenStore.put("oauth_scopes", scopes.joinToString(" "))
        val url = AuthorizeUrl.build(provider, id, normalized, state, pkce.challenge, scopes)
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse(url))
    }

    private fun disconnect(provider: String) {
        listOf("token", "refresh", "scopes", "expiry").forEach { tokenStore.delete("$it.$provider") }
        connected.remove(provider)
        lastFiles.removeAll { it.provider == provider }
        groups = emptyList()
        findViewById<LinearLayout>(R.id.results).removeAllViews()
        findViewById<LinearLayout>(R.id.savings).visibility = View.GONE
        showEmpty(getString(if (sampleMode()) R.string.empty_connect else R.string.empty_connect_live))
        renderProviders()
    }

    private fun scan() {
        if (scanning) return
        clearError()
        val names = PROVIDERS.filter { it.first in connected && it.first != "onedrive" }
        if (names.isEmpty()) {
            showError(getString(if (sampleMode()) R.string.empty_connect else R.string.empty_connect_live))
            return
        }
        if (names.any { isLive(it.first) } && findViewById<TextView>(R.id.offline).visibility == View.VISIBLE) {
            showError(getString(R.string.offline))
            return
        }
        scanning = true
        findViewById<Button>(R.id.scan).isEnabled = false
        val progress = findViewById<ProgressBar>(R.id.progress)
        val label = findViewById<TextView>(R.id.progress_label)
        progress.visibility = View.VISIBLE
        label.visibility = View.VISIBLE
        progress.progress = 8
        label.text = getString(R.string.scan_starting)
        work.execute {
            val collected = mutableListOf<CloudFile>()
            val problems = mutableListOf<String>()
            names.forEachIndexed { index, (id, providerLabel) ->
                onUi {
                    progress.progress = ((index + 1) * 80 / names.size).coerceAtLeast(8)
                    label.text = getString(R.string.scanning_provider, providerLabel)
                }
                try {
                    if (isMock(id)) collected.addAll(library.files.filter { it.provider == id })
                    else if (id == "dropbox" || id == "gdrive") collected.addAll(cloud.list(id))
                } catch (_: Exception) {
                    problems.add(providerLabel)
                }
            }
            onUi {
                label.text = getString(R.string.grouping)
                progress.progress = 100
                lastFiles.clear()
                lastFiles.addAll(collected)
                finishScan()
                if (problems.isNotEmpty()) showError(getString(R.string.list_failed, problems.joinToString()))
                scanning = false
                findViewById<Button>(R.id.scan).isEnabled = true
                progress.visibility = View.GONE
                label.visibility = View.GONE
            }
        }
    }

    private fun finishScan() {
        val files = lastFiles.toList()
        groups = DuplicateFinder.find(files)
        val wasted = groups.sumOf { it.wastedBytes ?: 0L }
        val savings = findViewById<LinearLayout>(R.id.savings)
        savings.visibility = View.VISIBLE
        findViewById<TextView>(R.id.savings_value).text = formatBytes(wasted)
        val summary = findViewById<TextView>(R.id.summary)
        val host = findViewById<LinearLayout>(R.id.results)
        host.removeAllViews()
        if (groups.isEmpty()) {
            summary.text = getString(R.string.empty_results)
            showEmpty(getString(R.string.empty_results))
            return
        }
        hideEmpty()
        summary.text = getString(R.string.scan_detail, files.size, groups.size)
        groups.forEach { group -> host.addView(groupCard(group)) }
    }

    private fun groupCard(group: DuplicateGroup): View {
        val card = layoutInflater.inflate(R.layout.item_group, findViewById(R.id.results), false)
        val files = group.files
        bindThumb(card.findViewById(R.id.thumb_a), files.getOrNull(0))
        bindThumb(card.findViewById(R.id.thumb_b), files.getOrNull(1))
        card.findViewById<TextView>(R.id.group_title).text =
            getString(R.string.group_title, group.count, formatBytes(group.wastedBytes))
        card.findViewById<TextView>(R.id.group_badge).text =
            if (group.match == "content") getString(R.string.content_hash) else getString(R.string.weaker_match)
        card.contentDescription = card.findViewById<TextView>(R.id.group_title).text
        card.setOnClickListener { openCompare(group) }
        return card
    }

    private fun bindThumb(frame: FrameLayout, file: CloudFile?) {
        frame.removeAllViews()
        if (file == null) return
        frame.addView(preview(file))
    }

    private fun preview(file: CloudFile): View {
        val res = when (file.sampleKey) {
            "holiday" -> R.drawable.sample_holiday
            "camera" -> R.drawable.sample_camera
            else -> 0
        }
        if (file.kind == "image" && res != 0) return imageView(file, res)
        if (file.kind == "image" && isLive(file.provider) && canPreview(file)) {
            val view = imageView(file, 0)
            val cached = thumbCache.get(file.id)
            if (cached != null) {
                view.setImageBitmap(cached)
            } else {
                view.setBackgroundResource(R.drawable.bg_icon_tile)
                work.execute {
                    val bitmap = try {
                        val bytes = cloud.thumbnail(file)
                        val options = BitmapFactory.Options().apply {
                            inSampleSize = if (bytes.size > 1_000_000) 2 else 1
                        }
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                    } catch (_: Exception) {
                        null
                    }
                    if (bitmap != null) {
                        thumbCache.put(file.id, bitmap)
                        onUi { if (view.tag == file.id) view.setImageBitmap(bitmap) }
                    }
                }
            }
            return view
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
            setTextColor(themeColor(R.attr.cdcMuted))
            setBackgroundResource(R.drawable.bg_icon_tile)
            contentDescription = text
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
    }

    private fun imageView(file: CloudFile, res: Int): ImageView {
        return ImageView(this).apply {
            tag = file.id
            if (res != 0) setImageResource(res)
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = getString(R.string.preview_of, file.name)
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            )
        }
    }

    private fun canPreview(file: CloudFile): Boolean {
        if (file.provider == "dropbox") return file.path.startsWith("/")
        return !file.thumbnailUrl.isNullOrBlank()
    }

    private fun themeColor(attr: Int): Int {
        val typed = obtainStyledAttributes(intArrayOf(attr))
        val color = typed.getColor(0, 0xFFEEF3EF.toInt())
        typed.recycle()
        return color
    }

    private fun openCompare(group: DuplicateGroup) {
        val keeper = group.files.firstOrNull { it.trashable } ?: group.files.first()
        keeperId = keeper.id
        val body = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        group.files.forEach { file ->
            val shot = preview(file)
            shot.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 280)
            body.addView(shot)
            body.addView(TextView(this).apply {
                text = "${file.name}\n${providerLabel(file.provider)} · ${formatBytes(file.size)}\n${formatDate(file.modifiedAt)}\n${file.path}"
                setTextColor(themeColor(R.attr.cdcText))
                setPadding(0, 8, 0, 4)
            })
            if (!file.trashable) {
                body.addView(TextView(this).apply {
                    text = getString(R.string.no_trash_api)
                    setTextColor(themeColor(R.attr.cdcDanger))
                })
            }
            body.addView(RadioButton(this).apply {
                id = View.generateViewId()
                text = getString(R.string.keep_this)
                tag = file.id
                isChecked = file.id == keeperId
                contentDescription = getString(R.string.keep_this) + " " + file.name
                setTextColor(themeColor(R.attr.cdcText))
            })
        }
        body.setOnCheckedChangeListener { groupView, checkedId ->
            keeperId = groupView.findViewById<RadioButton>(checkedId)?.tag as? String ?: keeperId
        }
        AlertDialog.Builder(this)
            .setTitle(if (group.match == "content") getString(R.string.content_hash) else getString(R.string.weaker_match))
            .setView(body)
            .setNegativeButton(android.R.string.cancel, null)
            .setNeutralButton(R.string.review_photos) { _, _ ->
                val photos = group.files.filter { it.provider == "gphotos" }
                if (photos.isNotEmpty()) confirmAlbum(photos)
            }
            .setPositiveButton(R.string.move_others) { _, _ ->
                val extras = group.files.filter { it.trashable && it.id != keeperId }.map { it.id }
                if (extras.isEmpty() || extras.size >= group.files.size) {
                    showError(getString(R.string.keep_one))
                } else {
                    confirmTrash(group, extras)
                }
            }
            .show()
    }

    private fun confirmTrash(group: DuplicateGroup, selected: List<String>) {
        val names = group.files.filter { it.id in selected }.joinToString("\n") { "${it.name} · ${it.path}" }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.move_count, selected.size))
            .setMessage("${getString(R.string.trash_message)}\n\n$names")
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.move_to_trash) { _, _ ->
                try {
                    val planned = TrashPolicy.plan(groups, selected, TrashPolicy.TRASH_CONFIRMATION)
                    val needsAuth = planned.firstOrNull { needsTrashAuth(it.provider) }
                    if (needsAuth != null) {
                        tokenStore.put("pending_trash", planned.joinToString("\n") { it.id })
                        showError(getString(R.string.trash_permission))
                        startOAuth(needsAuth.provider, "trash")
                    } else {
                        executeTrash(planned)
                    }
                } catch (error: PolicyException) {
                    showError(error.message ?: getString(R.string.keep_one))
                }
            }
            .show()
    }

    private fun continuePendingTrash() {
        val raw = tokenStore.get("pending_trash").orEmpty()
        if (raw.isBlank()) return
        if (groups.isEmpty()) {
            tokenStore.delete("pending_trash")
            showError(getString(R.string.trash_again))
            return
        }
        val ids = raw.split('\n').filter { it.isNotBlank() }
        try {
            val planned = TrashPolicy.plan(groups, ids, TrashPolicy.TRASH_CONFIRMATION)
            if (planned.any { needsTrashAuth(it.provider) }) {
                tokenStore.delete("pending_trash")
                showError(getString(R.string.trash_permission_missing))
                return
            }
            tokenStore.delete("pending_trash")
            executeTrash(planned)
        } catch (error: PolicyException) {
            tokenStore.delete("pending_trash")
            showError(error.message ?: getString(R.string.keep_one))
        }
    }

    private fun executeTrash(planned: List<CloudFile>) {
        if (scanning) return
        scanning = true
        findViewById<Button>(R.id.scan).isEnabled = false
        work.execute {
            var failed = false
            for (file in planned) {
                try {
                    if (isMock(file.provider)) library.trash(file) else cloud.trash(file)
                    lastFiles.removeAll { it.id == file.id }
                } catch (_: Exception) {
                    failed = true
                }
            }
            onUi {
                finishScan()
                scanning = false
                findViewById<Button>(R.id.scan).isEnabled = true
                if (failed) showError(getString(R.string.trash_failed)) else clearError()
            }
        }
    }

    private fun confirmAlbum(photos: List<CloudFile>) {
        val steps = TrashPolicy.photosManualSteps.joinToString("\n")
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.photos_title))
            .setMessage("$steps\n\n${photos.joinToString { it.name }}")
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.add_album) { _, _ ->
                library.addToReviewAlbum(photos)
                findViewById<TextView>(R.id.summary).text = getString(R.string.album_added)
            }
            .show()
    }

    private fun providerLabel(id: String) = PROVIDERS.find { it.first == id }?.second ?: id

    private fun formatBytes(bytes: Long?): String {
        if (bytes == null) return getString(R.string.size_unknown)
        if (bytes < 1024) return "$bytes B"
        val kb = bytes / 1024.0
        if (kb < 1024) return String.format("%.1f KB", kb)
        return String.format("%.1f MB", kb / 1024.0)
    }

    private fun formatDate(iso: String?): String {
        if (iso.isNullOrBlank()) return getString(R.string.date_unknown)
        return try {
            DateFormat.getDateInstance().format(Date(java.time.Instant.parse(iso).toEpochMilli()))
        } catch (_: Exception) {
            iso
        }
    }

    private fun clientId(provider: String): String {
        return when (provider) {
            "dropbox" -> BuildConfig.DROPBOX_CLIENT_ID
            "gdrive" -> BuildConfig.GOOGLE_CLIENT_ID
            else -> ""
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
