package com.njg.clouddupecleaner

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

data class PkceChallenge(val verifier: String, val challenge: String, val method: String)

object Pkce {
    fun create(): PkceChallenge {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        val verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
        return PkceChallenge(verifier, challenge, "S256")
    }
}

object Redirects {
    fun normalize(redirectUri: String, allowlist: List<String>): String {
        val raw = redirectUri.trim()
        if (raw.isEmpty() || raw.length > 300 || raw.any { it.isWhitespace() || it == '\\' || it == '@' } || raw.contains("..")) {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        if (!uri.userInfo.isNullOrEmpty() || !uri.query.isNullOrEmpty() || !uri.fragment.isNullOrEmpty()) {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        if (uri.scheme != "https" && uri.scheme != "http") {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        val port = if (uri.port == -1) "" else ":${uri.port}"
        val normalized = "${uri.scheme}://${uri.host}$port${uri.path}"
        if (normalized != raw || normalized !in allowlist) {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        return normalized
    }
}

object AuthorizeUrl {
    fun build(
        provider: String,
        clientId: String,
        redirectUri: String,
        state: String,
        codeChallenge: String,
        scopes: List<String>,
    ): String {
        val base = when (provider) {
            "dropbox" -> "https://www.dropbox.com/oauth2/authorize"
            "onedrive" -> "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
            "gdrive", "gphotos" -> "https://accounts.google.com/o/oauth2/v2/auth"
            else -> throw PolicyException("unknown_provider", "Unknown provider.")
        }
        val query = linkedMapOf(
            "client_id" to clientId,
            "redirect_uri" to redirectUri,
            "response_type" to "code",
            "state" to state,
            "code_challenge" to codeChallenge,
            "code_challenge_method" to "S256",
            "scope" to scopes.joinToString(" "),
        )
        val encoded = query.entries.joinToString("&") { (key, value) ->
            "${enc(key)}=${enc(value)}"
        }
        val url = "$base?$encoded"
        if (url.contains("client_secret") || url.contains("response_type=token")) {
            throw PolicyException("oauth_config", "OAuth request was rejected.")
        }
        return url
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")
}
