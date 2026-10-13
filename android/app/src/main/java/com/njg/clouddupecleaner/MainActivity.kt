package com.njg.clouddupecleaner

import android.app.Activity
import android.app.AlertDialog
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.browser.customtabs.CustomTabsIntent

class MainActivity : Activity() {
    private val library = MockLibrary()
    private val connected = linkedSetOf<String>()
    private val boxes = linkedMapOf<String, CheckBox>()
    private var groups: List<DuplicateGroup> = emptyList()
    private lateinit var tokenStore: TokenStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tokenStore = openStore()
        PROVIDERS.forEach { provider ->
            if (tokenStore.get("token.$provider") != null) connected.add(provider)
        }
        renderProviders()
        findViewById<Button>(R.id.scan).setOnClickListener { scan() }
    }

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
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            val action = Button(this).apply {
                text = if (id in connected) "Disconnect" else "Connect sample"
                setOnClickListener {
                    if (id in connected) disconnect(id) else connect(id)
                }
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
                "dropbox" -> listOf("files.metadata.read")
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
        val files = library.files.filter { it.provider in connected }
        groups = DuplicateFinder.find(files)
        boxes.clear()
        val host = findViewById<LinearLayout>(R.id.results)
        host.removeAllViews()
        val wasted = groups.sumOf { it.wastedBytes ?: 0L }
        findViewById<TextView>(R.id.summary).text = if (groups.isEmpty()) {
            "No duplicate groups in the connected sample accounts."
        } else {
            "${groups.size} duplicate groups · $wasted bytes could move to trash"
        }
        groups.forEach { group ->
            host.addView(TextView(this).apply {
                text = if (group.match == "content") {
                    "${group.count} copies · content hash ${group.hashAlgo}"
                } else {
                    "${group.count} copies · name and size only"
                }
                textSize = 18f
                setPadding(0, 24, 0, 8)
            })
            group.files.forEach { file ->
                if (file.trashable) {
                    val box = CheckBox(this).apply { text = "${file.provider} · ${file.name} · ${file.path}" }
                    boxes[file.id] = box
                    host.addView(box)
                } else {
                    host.addView(TextView(this).apply { text = "No trash API · ${file.name}" })
                }
            }
            if (group.files.any { it.trashable }) {
                host.addView(Button(this).apply {
                    text = "Move selected to trash"
                    setOnClickListener { confirmTrash(group) }
                })
            }
            val photos = group.files.filter { it.provider == "gphotos" }
            if (photos.isNotEmpty()) {
                host.addView(Button(this).apply {
                    text = "Review Photos copies"
                    setOnClickListener { confirmAlbum(photos) }
                })
            }
        }
    }

    private fun confirmTrash(group: DuplicateGroup) {
        val selected = group.files.filter { boxes[it.id]?.isChecked == true }.map { it.id }
        if (selected.isEmpty()) {
            findViewById<TextView>(R.id.summary).text = "Select at least one extra copy."
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Move ${selected.size} files to trash?")
            .setMessage(getString(R.string.trash_message))
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Move to trash") { _, _ ->
                val planned = TrashPolicy.plan(groups, selected, TrashPolicy.TRASH_CONFIRMATION)
                planned.forEach { library.trash(it) }
                scan()
                findViewById<TextView>(R.id.summary).text = "Moved ${planned.size} files to trash."
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

    private fun clientId(provider: String): String {
        return when (provider) {
            "dropbox" -> BuildConfig.DROPBOX_CLIENT_ID
            "onedrive" -> BuildConfig.ONEDRIVE_CLIENT_ID
            else -> BuildConfig.GOOGLE_CLIENT_ID
        }
    }

    companion object {
        val PROVIDERS = listOf(
            "dropbox" to "Dropbox",
            "onedrive" to "OneDrive",
            "gdrive" to "Google Drive",
            "gphotos" to "Google Photos",
        )
    }
}
