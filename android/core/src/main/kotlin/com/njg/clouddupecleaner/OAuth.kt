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

/**
 * Installed-app redirects. Dropbox is the app scheme. Google's Android client
 * only accepts the reverse client id, with no secret.
 */
object InstalledAppRedirect {
    const val DROPBOX = "clouddupecleaner://oauth"
    private val GOOGLE = Regex("^com\\.googleusercontent\\.apps\\.[0-9]+-[a-z0-9]+:/oauth2redirect$")
    private val GOOGLE_CLIENT = Regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$")

    fun isAllowedCustom(raw: String): Boolean = raw == DROPBOX || GOOGLE.matches(raw)

    fun google(clientId: String): String {
        if (!GOOGLE_CLIENT.matches(clientId)) {
            throw PolicyException("oauth_config", "Google client id was rejected.")
        }
        val prefix = clientId.removeSuffix(".apps.googleusercontent.com")
        return "com.googleusercontent.apps.$prefix:/oauth2redirect"
    }
}

object Redirects {
    fun normalize(redirectUri: String, allowlist: List<String>): String {
        val raw = redirectUri.trim()
        if (raw.isEmpty() || raw.length > 300 || raw.any { it.isWhitespace() || it == '\\' || it == '@' } || raw.contains("..")) {
            throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
        }
        if (InstalledAppRedirect.isAllowedCustom(raw)) {
            if (raw !in allowlist) {
                throw PolicyException("redirect_rejected", "Redirect URL was rejected.")
            }
            return raw
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
        if (provider == "dropbox") {
            query["token_access_type"] = "offline"
        }
        if (provider == "gdrive" || provider == "gphotos") {
            query["access_type"] = "offline"
            query["include_granted_scopes"] = "true"
            query["prompt"] = "consent"
        }
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

object ProviderScopes {
    fun connect(provider: String): List<String> = when (provider) {
        "dropbox" -> listOf("files.metadata.read", "files.content.read")
        "gdrive" -> listOf("https://www.googleapis.com/auth/drive.readonly")
        else -> throw PolicyException("unknown_provider", "Unknown provider.")
    }

    fun trash(provider: String): List<String> = when (provider) {
        "dropbox" -> listOf("files.metadata.read", "files.content.read", "files.content.write")
        "gdrive" -> listOf(
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive",
        )
        else -> throw PolicyException("unknown_provider", "Unknown provider.")
    }

    fun trashScope(provider: String): String = when (provider) {
        "dropbox" -> "files.content.write"
        "gdrive" -> "https://www.googleapis.com/auth/drive"
        else -> ""
    }
}
