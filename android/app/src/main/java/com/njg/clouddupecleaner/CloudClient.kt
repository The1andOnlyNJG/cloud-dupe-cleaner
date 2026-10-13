package com.njg.clouddupecleaner

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/**
 * HTTPS calls for Dropbox and Google Drive. Tokens stay in [TokenStore].
 * Responses are not logged. Authorization is added here and is not part of [ApiCall].
 */
class CloudClient(
    private val store: TokenStore,
    private val dropboxClientId: String,
    private val googleClientId: String,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    fun exchange(provider: String, code: String, verifier: String, redirectUri: String): TokenResponse {
        val call = DriveDropbox.authorizationCode(provider, clientId(provider), code, redirectUri, verifier)
        return DriveDropbox.parseToken(text(execute(call, null, 1_000_000, 0)))
    }

    fun saveToken(provider: String, parsed: TokenResponse, fallbackScopes: String?) {
        store.put("token.$provider", parsed.accessToken)
        val refreshToken = parsed.refreshToken
        if (!refreshToken.isNullOrBlank()) store.put("refresh.$provider", refreshToken)
        val scopes = parsed.scopes.ifEmpty {
            fallbackScopes.orEmpty().split(Regex("\\s+")).filter { it.isNotBlank() }
        }
        if (scopes.isNotEmpty()) store.put("scopes.$provider", scopes.joinToString(" "))
        val seconds = parsed.expiresInSeconds?.takeIf { it > 0 } ?: 2700L
        store.put("expiry.$provider", (System.currentTimeMillis() + seconds * 1000).toString())
    }

    fun list(provider: String): List<CloudFile> {
        if (provider != "dropbox" && provider != "gdrive") {
            throw PolicyException("unknown_provider", "Unknown provider.")
        }
        val files = mutableListOf<CloudFile>()
        val seen = HashSet<String>()
        var cursor: String? = null
        var pages = 0
        while (pages < 50) {
            pages += 1
            val call = if (provider == "dropbox") DriveDropbox.listDropbox(cursor) else DriveDropbox.listDrive(cursor)
            val raw = text(executeAuthorized(provider, call, 8_000_000))
            val page = if (provider == "dropbox") DriveDropbox.parseDropbox(raw) else DriveDropbox.parseDrive(raw)
            files.addAll(page.files)
            val next = page.nextCursor
            if (next.isNullOrBlank() || !seen.add(next)) break
            cursor = next
        }
        return files
    }

    fun thumbnail(file: CloudFile): ByteArray {
        return executeAuthorized(file.provider, DriveDropbox.thumbnail(file), 2_000_000)
    }

    fun trash(file: CloudFile) {
        executeAuthorized(file.provider, DriveDropbox.trash(file), 1_000_000)
    }

    private fun executeAuthorized(provider: String, call: ApiCall, maxBytes: Int): ByteArray {
        val first = freshAccess(provider, force = false)
        return try {
            execute(call, first, maxBytes, 0)
        } catch (error: PolicyException) {
            if (error.code != "unauthorized") throw error
            execute(call, freshAccess(provider, force = true), maxBytes, 0)
        }
    }

    private fun freshAccess(provider: String, force: Boolean): String {
        val current = store.get("token.$provider").orEmpty()
        if (current.isBlank() || current.startsWith("mock-access.")) {
            throw PolicyException("not_connected", "Connect this provider first.")
        }
        val expiry = store.get("expiry.$provider")?.toLongOrNull() ?: 0L
        val refresh = store.get("refresh.$provider")
        val stale = force || expiry < System.currentTimeMillis() + 60_000
        if (!stale) return current
        if (refresh.isNullOrBlank()) {
            if (force) throw PolicyException("token_expired", "Connect this account again.")
            return current
        }
        val call = DriveDropbox.refresh(provider, clientId(provider), refresh)
        val parsed = try {
            DriveDropbox.parseToken(text(execute(call, null, 1_000_000, 0)))
        } catch (_: PolicyException) {
            throw PolicyException("token_expired", "Connect this account again.")
        }
        saveToken(provider, parsed, store.get("scopes.$provider"))
        return parsed.accessToken
    }

    private fun clientId(provider: String): String = when (provider) {
        "dropbox" -> dropboxClientId
        "gdrive" -> googleClientId
        else -> throw PolicyException("unknown_provider", "Unknown provider.")
    }

    private fun execute(call: ApiCall, bearer: String?, maxBytes: Int, redirects: Int): ByteArray {
        ApiHosts.check(call.url, call.kind)
        if (call.kind == "google-drive" && call.method.equals("DELETE", true)) {
            throw PolicyException("hard_delete_forbidden", "Drive files.delete permanently deletes files and is refused.")
        }
        val builder = Request.Builder().url(call.url)
        call.headers.forEach { (name, value) ->
            if (!name.equals("Authorization", true)) builder.header(name, value)
        }
        if (!bearer.isNullOrBlank()) builder.header("Authorization", "Bearer $bearer")
        val method = call.method.uppercase()
        val contentType = call.headers.entries.firstOrNull { it.key.equals("Content-Type", true) }?.value
        val payload = call.body
        val body = when {
            payload != null -> payload.toRequestBody((contentType ?: "application/json").toMediaType())
            method == "POST" || method == "PATCH" || method == "PUT" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        builder.method(method, body)
        val response = try {
            http.newCall(builder.build()).execute()
        } catch (_: Exception) {
            throw failure(call)
        }
        response.use { resp ->
            if (resp.code in 300..399 && call.kind == "google-thumb" && redirects < 1) {
                val next = DriveDropbox.allowedThumbnail(resp.header("Location"))
                    ?: throw PolicyException("no_preview", "This file has no image preview.")
                return execute(
                    call.copy(url = next, method = "GET", body = null, headers = emptyMap()),
                    bearer,
                    maxBytes,
                    redirects + 1,
                )
            }
            if (resp.code == 401) throw PolicyException("unauthorized", "Connect this account again.")
            val bytes = resp.body?.let { readLimited(it, maxBytes, call) } ?: ByteArray(0)
            if (resp.code !in 200..299) throw failure(call)
            return bytes
        }
    }

    private fun readLimited(body: ResponseBody, maxBytes: Int, call: ApiCall): ByteArray {
        val buffer = ByteArrayOutputStream()
        body.byteStream().use { stream ->
            val chunk = ByteArray(8192)
            var total = 0
            while (true) {
                val count = stream.read(chunk)
                if (count < 0) break
                total += count
                if (total > maxBytes) throw failure(call)
                buffer.write(chunk, 0, count)
            }
        }
        return buffer.toByteArray()
    }

    private fun text(bytes: ByteArray): String = bytes.toString(Charsets.UTF_8)

    private fun failure(call: ApiCall): PolicyException {
        val (code, message) = when {
            call.kind == "google-auth" || call.url.endsWith("/oauth2/token") ->
                "token_exchange" to "The provider did not complete sign-in."
            call.url.contains("delete_v2") || call.method.equals("PATCH", true) ->
                "trash_failed" to "The provider did not move the file to trash."
            call.kind == "google-thumb" || call.kind == "dropbox-content" ->
                "no_preview" to "This file has no image preview."
            call.kind == "dropbox-api" -> "list_failed" to "Dropbox file list failed."
            else -> "list_failed" to "Google Drive file list failed."
        }
        return PolicyException(code, message)
    }
}
