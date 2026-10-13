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

fun cloudFile(
    provider: String,
    localId: String,
    name: String,
    path: String,
    size: Long?,
    hash: String?,
    hashAlgo: String?,
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
    )
}
