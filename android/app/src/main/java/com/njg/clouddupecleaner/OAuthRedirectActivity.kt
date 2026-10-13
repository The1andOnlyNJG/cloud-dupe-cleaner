package com.njg.clouddupecleaner

import android.app.Activity
import android.os.Bundle
import android.widget.TextView
import java.security.MessageDigest

/**
 * Receives the OAuth redirect. The authorization code is not shown, logged, or stored.
 * State must match the value saved before the browser was opened.
 */
class OAuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val state = intent?.data?.getQueryParameter("state").orEmpty()
        val error = intent?.data?.getQueryParameter("error")
        val store = openStore()
        val expected = store?.get("oauth_state").orEmpty()
        val matched = state.isNotEmpty() &&
            expected.isNotEmpty() &&
            MessageDigest.isEqual(state.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))
        store?.delete("oauth_state")
        store?.delete("oauth_verifier")
        val message = when {
            error != null -> "Sign-in was cancelled."
            matched -> "Sign-in returned to the app. Finish it from the account screen."
            else -> "The sign-in session did not match. Connect again."
        }
        setContentView(TextView(this).apply {
            text = message
            setPadding(48, 48, 48, 48)
            textSize = 18f
        })
    }

    private fun openStore(): TokenStore? {
        return try {
            SecureTokenStore.open(this)
        } catch (_: Exception) {
            null
        }
    }
}
