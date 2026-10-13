package com.njg.clouddupecleaner

data class CloudFile(
    val id: String,
    val provider: String,
    val name: String,
    val path: String,
    val size: Long?,
    val hash: String?,
    val hashAlgo: String?,
    val trashable: Boolean,
    val modifiedAt: String? = null,
    val kind: String = "other",
    val sampleKey: String? = null,
    val thumbnailUrl: String? = null,
)

data class DuplicateGroup(
    val id: String,
    val match: String,
    val hashAlgo: String?,
    val hash: String?,
    val count: Int,
    val size: Long?,
    val wastedBytes: Long?,
    val files: List<CloudFile>,
)

fun kindFromName(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return when (ext) {
        "jpg", "jpeg", "png", "gif", "webp", "heic" -> "image"
        "mp4", "mov", "webm", "mkv" -> "video"
        "pdf" -> "pdf"
        "xls", "xlsx", "csv" -> "sheet"
        "txt", "md" -> "text"
        else -> "other"
    }
}

fun cloudFile(
    provider: String,
    localId: String,
    name: String,
    path: String,
    size: Long?,
    hash: String?,
    hashAlgo: String?,
    modifiedAt: String? = null,
    sampleKey: String? = null,
    thumbnailUrl: String? = null,
): CloudFile {
    return CloudFile(
        id = "$provider:$localId",
        provider = provider,
        name = name,
        path = path,
        size = size,
        hash = hash,
        hashAlgo = hashAlgo,
        trashable = provider != "gphotos",
        modifiedAt = modifiedAt,
        kind = kindFromName(name),
        sampleKey = sampleKey,
        thumbnailUrl = thumbnailUrl,
    )
}
