package com.njg.clouddupecleaner

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder

data class ApiCall(
    val url: String,
    val method: String,
    val body: String?,
    val headers: Map<String, String>,
    val kind: String,
)

data class FilePage(val files: List<CloudFile>, val nextCursor: String?)

data class TokenResponse(
    val accessToken: String,
    val refreshToken: String?,
    val expiresInSeconds: Long?,
    val scopes: List<String>,
)

object ApiHosts {
    fun check(url: String, kind: String) {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            throw PolicyException("request_rejected", "Request was rejected.")
        }
        if (uri.scheme != "https" || !uri.userInfo.isNullOrEmpty()) {
            throw PolicyException("request_rejected", "Request was rejected.")
        }
        val host = uri.host?.lowercase() ?: throw PolicyException("request_rejected", "Request was rejected.")
        val query = uri.rawQuery?.lowercase().orEmpty()
        if ("access_token=" in query || "client_secret=" in query || "code_verifier=" in query) {
            throw PolicyException("request_rejected", "Request was rejected.")
        }
        val ok = when (kind) {
            "dropbox-api" -> host == "api.dropboxapi.com"
            "dropbox-content" -> host == "content.dropboxapi.com"
            "google-auth" -> host == "oauth2.googleapis.com"
            "google-drive" -> host == "www.googleapis.com" && uri.path.startsWith("/drive/")
            "google-thumb" -> host == "googleusercontent.com" || host.endsWith(".googleusercontent.com")
            else -> false
        }
        if (!ok) throw PolicyException("request_rejected", "Request was rejected.")
        val lower = url.lowercase()
        if ("permanently_delete" in lower || "permanentdelete" in lower || "batchdelete" in lower) {
            throw PolicyException("hard_delete_forbidden", "Permanent delete is not allowed.")
        }
    }
}

object DriveDropbox {
    private const val PAGE_GUARD = 16_000

    fun authorizationCode(
        provider: String,
        clientId: String,
        code: String,
        redirectUri: String,
        codeVerifier: String,
    ): ApiCall {
        rejectBlank(clientId, "oauth_config")
        rejectBlank(code, "token_exchange")
        rejectBlank(codeVerifier, "token_exchange")
        if (code.any { it.isWhitespace() } || codeVerifier.any { it.isWhitespace() }) {
            throw PolicyException("token_exchange", "The provider did not complete sign-in.")
        }
        return tokenCall(
            provider,
            form(
                "grant_type" to "authorization_code",
                "code" to code,
                "redirect_uri" to redirectUri,
                "client_id" to clientId,
                "code_verifier" to codeVerifier,
            ),
        )
    }

    fun refresh(provider: String, clientId: String, refreshToken: String): ApiCall {
        rejectBlank(clientId, "oauth_config")
        rejectBlank(refreshToken, "token_expired")
        return tokenCall(
            provider,
            form(
                "grant_type" to "refresh_token",
                "refresh_token" to refreshToken,
                "client_id" to clientId,
            ),
        )
    }

    fun parseToken(raw: String): TokenResponse {
        val json = try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw PolicyException("token_exchange", "The provider did not complete sign-in.")
        }
        val access = json.optString("access_token", "")
        if (access.isBlank() || access.length > 4096 || access.any { it.isWhitespace() }) {
            throw PolicyException("token_exchange", "The provider did not complete sign-in.")
        }
        val refresh = json.optString("refresh_token", "").ifBlank { null }
        if (refresh != null && (refresh.length > 4096 || refresh.any { it.isWhitespace() })) {
            throw PolicyException("token_exchange", "The provider did not complete sign-in.")
        }
        val scopes = json.optString("scope", "")
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
        return TokenResponse(access, refresh, longValue(json, "expires_in"), scopes)
    }

    fun listDropbox(cursor: String?): ApiCall {
        val url: String
        val body: String
        if (cursor.isNullOrEmpty()) {
            url = "https://api.dropboxapi.com/2/files/list_folder"
            body = JSONObject()
                .put("path", "")
                .put("recursive", true)
                .put("limit", 2000)
                .put("include_deleted", false)
                .toString()
        } else {
            if (cursor.length > PAGE_GUARD || cursor.any { it.isISOControl() }) {
                throw PolicyException("list_failed", "Dropbox file list failed.")
            }
            url = "https://api.dropboxapi.com/2/files/list_folder/continue"
            body = JSONObject().put("cursor", cursor).toString()
        }
        return checked(ApiCall(url, "POST", body, jsonHeaders(), "dropbox-api"))
    }

    fun parseDropbox(raw: String): FilePage {
        val json = readJson(raw, "Dropbox file list failed.")
        val entries = json.optJSONArray("entries") ?: JSONArray()
        val files = mutableListOf<CloudFile>()
        for (index in 0 until entries.length()) {
            val entry = entries.optJSONObject(index) ?: continue
            if (entry.optString(".tag") != "file") continue
            val id = entry.optString("id", "")
            val name = entry.optString("name", "")
            if (id.isBlank() || name.isBlank()) continue
            val hash = entry.optString("content_hash", "").trim().ifBlank { null }
            val path = entry.optString("path_display", "").ifBlank { name }
            val modified = entry.optString("client_modified", "").ifBlank {
                entry.optString("server_modified", "")
            }.ifBlank { null }
            files.add(
                cloudFile(
                    "dropbox",
                    id,
                    name,
                    path,
                    longValue(entry, "size"),
                    hash,
                    if (hash == null) null else "dropbox-content-hash",
                    modified,
                ),
            )
        }
        val cursor = json.optString("cursor", "").ifBlank { null }
        val next = if (json.optBoolean("has_more", false)) cursor else null
        return FilePage(files, next)
    }

    fun listDrive(pageToken: String?): ApiCall {
        val query = linkedMapOf(
            "pageSize" to "1000",
            "fields" to "nextPageToken,files(id,name,md5Checksum,sha1Checksum,size,mimeType,trashed,modifiedTime,thumbnailLink)",
            "q" to "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
            "spaces" to "drive",
        )
        if (!pageToken.isNullOrBlank()) {
            if (pageToken.length > 2048 || pageToken.any { it.isISOControl() || it.isWhitespace() }) {
                throw PolicyException("list_failed", "Google Drive file list failed.")
            }
            query["pageToken"] = pageToken
        }
        val url = "https://www.googleapis.com/drive/v3/files?" + query.entries.joinToString("&") { (key, value) ->
            "${enc(key)}=${enc(value)}"
        }
        return checked(ApiCall(url, "GET", null, emptyMap(), "google-drive"))
    }

    fun parseDrive(raw: String): FilePage {
        val json = readJson(raw, "Google Drive file list failed.")
        val entries = json.optJSONArray("files") ?: JSONArray()
        val files = mutableListOf<CloudFile>()
        for (index in 0 until entries.length()) {
            val file = entries.optJSONObject(index) ?: continue
            val id = file.optString("id", "")
            val name = file.optString("name", "")
            if (id.isBlank() || name.isBlank()) continue
            if (file.optString("mimeType") == "application/vnd.google-apps.folder" || file.optBoolean("trashed", false)) {
                continue
            }
            val md5 = file.optString("md5Checksum", "").trim()
            val sha1 = file.optString("sha1Checksum", "").trim()
            val hash = md5.ifBlank { sha1 }.ifBlank { null }
            val algo = when {
                md5.isNotBlank() -> "md5"
                sha1.isNotBlank() -> "sha1"
                else -> null
            }
            files.add(
                cloudFile(
                    "gdrive",
                    id,
                    name,
                    name,
                    longValue(file, "size"),
                    hash,
                    algo,
                    file.optString("modifiedTime", "").ifBlank { null },
                    thumbnailUrl = allowedThumbnail(file.optString("thumbnailLink", "")),
                ),
            )
        }
        val next = json.optString("nextPageToken", "").ifBlank { null }
        return FilePage(files, next)
    }

    fun trash(file: CloudFile): ApiCall {
        if (file.provider == "gphotos" || !file.trashable) {
            throw PolicyException(
                "photos_cannot_trash",
                "Photos cannot be moved to trash by this app.",
            )
        }
        if (file.provider == "dropbox") {
            assertDropboxPath(file.path)
            val call = ApiCall(
                "https://api.dropboxapi.com/2/files/delete_v2",
                "POST",
                JSONObject().put("path", file.path).toString(),
                jsonHeaders(),
                "dropbox-api",
            )
            return checked(call)
        }
        if (file.provider == "gdrive") {
            val localId = localId(file.id, "gdrive")
            assertItemId(localId)
            val call = ApiCall(
                "https://www.googleapis.com/drive/v3/files/${enc(localId)}",
                "PATCH",
                JSONObject().put("trashed", true).toString(),
                jsonHeaders(),
                "google-drive",
            )
            if (call.method == "DELETE") {
                throw PolicyException("hard_delete_forbidden", "Drive files.delete permanently deletes files and is refused.")
            }
            return checked(call)
        }
        throw PolicyException("unknown_provider", "Unknown provider.")
    }

    fun thumbnail(file: CloudFile): ApiCall {
        if (file.provider == "dropbox") {
            assertDropboxPath(file.path)
            if (file.kind != "image") throw PolicyException("no_preview", "This file has no image preview.")
            val arg = JSONObject()
                .put("resource", JSONObject().put(".tag", "path").put("path", file.path))
                .put("format", "jpeg")
                .put("size", "w256h256")
                .put("mode", "strict")
                .toString()
            if (arg.any { it == '\r' || it == '\n' }) {
                throw PolicyException("no_preview", "This file has no image preview.")
            }
            return checked(
                ApiCall(
                    "https://content.dropboxapi.com/2/files/get_thumbnail_v2",
                    "POST",
                    null,
                    mapOf("Dropbox-API-Arg" to arg),
                    "dropbox-content",
                ),
            )
        }
        if (file.provider == "gdrive") {
            val url = allowedThumbnail(file.thumbnailUrl)
                ?: throw PolicyException("no_preview", "This file has no image preview.")
            return checked(ApiCall(url, "GET", null, emptyMap(), "google-thumb"))
        }
        throw PolicyException("no_preview", "This file has no image preview.")
    }

    fun allowedThumbnail(raw: String?): String? {
        if (raw.isNullOrBlank() || raw.length > 2048 || raw.any { it.isWhitespace() || it == '\\' }) return null
        val uri = try {
            URI(raw)
        } catch (_: Exception) {
            return null
        }
        if (uri.scheme != "https" || !uri.userInfo.isNullOrEmpty()) return null
        val host = uri.host?.lowercase() ?: return null
        if (host != "googleusercontent.com" && !host.endsWith(".googleusercontent.com")) return null
        return raw
    }

    private fun tokenCall(provider: String, body: String): ApiCall {
        if (body.split("&").any { it.substringBefore("=") == "client_secret" }) {
            throw PolicyException("oauth_config", "OAuth request was rejected.")
        }
        val (url, kind) = when (provider) {
            "dropbox" -> "https://api.dropboxapi.com/oauth2/token" to "dropbox-api"
            "gdrive" -> "https://oauth2.googleapis.com/token" to "google-auth"
            else -> throw PolicyException("unknown_provider", "Unknown provider.")
        }
        return checked(
            ApiCall(
                url,
                "POST",
                body,
                mapOf(
                    "Content-Type" to "application/x-www-form-urlencoded",
                    "Accept" to "application/json",
                ),
                kind,
            ),
        )
    }

    private fun checked(call: ApiCall): ApiCall {
        ApiHosts.check(call.url, call.kind)
        if (call.kind == "google-drive" && call.method.equals("DELETE", true)) {
            throw PolicyException("hard_delete_forbidden", "Drive files.delete permanently deletes files and is refused.")
        }
        call.headers.forEach { (name, _) ->
            if (name.equals("Authorization", true)) {
                throw PolicyException("request_rejected", "Request was rejected.")
            }
        }
        return call
    }

    private fun jsonHeaders() = mapOf("Content-Type" to "application/json", "Accept" to "application/json")

    private fun form(vararg pairs: Pair<String, String>): String {
        return pairs.joinToString("&") { (key, value) -> "${enc(key)}=${enc(value)}" }
    }

    private fun enc(value: String): String = URLEncoder.encode(value, Charsets.UTF_8).replace("+", "%20")

    private fun readJson(raw: String, message: String): JSONObject {
        return try {
            JSONObject(raw)
        } catch (_: Exception) {
            throw PolicyException("list_failed", message)
        }
    }

    private fun rejectBlank(value: String, code: String) {
        if (value.isBlank() || value.length > 4096) {
            throw PolicyException(code, "The provider did not complete sign-in.")
        }
    }

    private fun longValue(json: JSONObject, key: String): Long? {
        if (!json.has(key) || json.isNull(key)) return null
        return when (val value = json.get(key)) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull()
            else -> null
        }
    }

    private fun localId(composite: String, provider: String): String {
        val prefix = "$provider:"
        if (!composite.startsWith(prefix) || composite.length <= prefix.length) {
            throw PolicyException("unknown_file", "File id was not recognized.")
        }
        return composite.substring(prefix.length)
    }

    private fun assertItemId(localId: String) {
        if (localId.length > 512 || localId.any { it.isWhitespace() || it == '/' || it == '\\' || it == '?' || it == '#' || it == '%' } || ".." in localId) {
            throw PolicyException("unknown_file", "File id was not recognized.")
        }
    }

    private fun assertDropboxPath(filePath: String) {
        if (!filePath.startsWith("/") || filePath.length > 2048) {
            throw PolicyException("unknown_file", "Dropbox path was not recognized.")
        }
        if (filePath.any { it == '\\' || it == '\u0000' || it == '\r' || it == '\n' } || filePath.split("/").contains("..")) {
            throw PolicyException("unknown_file", "Dropbox path was not recognized.")
        }
    }
}
