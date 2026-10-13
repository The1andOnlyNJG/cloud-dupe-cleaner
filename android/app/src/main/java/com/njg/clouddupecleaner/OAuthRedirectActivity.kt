package com.njg.clouddupecleaner

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import java.security.MessageDigest

/**
 * Receives the Dropbox and Google OAuth redirects. The authorization code is
 * exchanged once and is not shown, logged, or stored.
 */
class OAuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val data = intent?.data
        val state = data?.getQueryParameter("state").orEmpty()
        val error = data?.getQueryParameter("error")
        val code = data?.getQueryParameter("code").orEmpty()
        intent?.data = null
        val view = TextView(this).apply {
            text = getString(R.string.signin_finishing)
            setPadding(48, 48, 48, 48)
            textSize = 18f
        }
        setContentView(view)
        val store = openStore()
        if (store == null) {
            view.text = getString(R.string.secure_storage_unavailable)
            return
        }
        val expected = store.get("oauth_state").orEmpty()
        val provider = store.get("oauth_provider").orEmpty()
        val redirect = store.get("oauth_redirect").orEmpty()
        val verifier = store.get("oauth_verifier").orEmpty()
        val purpose = store.get("oauth_purpose").orEmpty()
        val requestedScopes = store.get("oauth_scopes")
        store.delete("oauth_state")
        store.delete("oauth_verifier")
        store.delete("oauth_provider")
        store.delete("oauth_redirect")
        store.delete("oauth_purpose")
        store.delete("oauth_scopes")
        val matched = state.isNotEmpty() &&
            expected.isNotEmpty() &&
            MessageDigest.isEqual(state.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))
        if (error != null || !matched || code.isBlank() || provider != "dropbox" && provider != "gdrive") {
            view.text = if (error != null) getString(R.string.signin_cancelled) else getString(R.string.signin_mismatch)
            return
        }
        Thread {
            val message = try {
                val allow = listOf(BuildConfig.DROPBOX_REDIRECT_URI, BuildConfig.GOOGLE_REDIRECT_URI).filter { it.isNotEmpty() }
                val normalized = Redirects.normalize(redirect, allow)
                val client = CloudClient(store, BuildConfig.DROPBOX_CLIENT_ID, BuildConfig.GOOGLE_CLIENT_ID)
                val tokens = client.exchange(provider, code, verifier, normalized)
                client.saveToken(provider, tokens, requestedScopes)
                store.put("oauth_resume", if (purpose == "trash") "trash" else "connect")
                null
            } catch (_: Exception) {
                getString(R.string.signin_failed)
            }
            runOnUiThread {
                if (message == null) {
                    startActivity(
                        Intent(this, MainActivity::class.java).addFlags(
                            Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                        ),
                    )
                    finish()
                } else if (!isDestroyed) {
                    view.text = message
                }
            }
        }.start()
    }

    private fun openStore(): TokenStore? {
        return try {
            SecureTokenStore.open(this)
        } catch (_: Exception) {
            null
        }
    }
}
