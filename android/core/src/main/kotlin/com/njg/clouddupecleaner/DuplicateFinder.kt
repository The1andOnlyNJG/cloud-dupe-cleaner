package com.njg.clouddupecleaner

import java.security.MessageDigest

object DuplicateFinder {
    fun find(files: List<CloudFile>): List<DuplicateGroup> {
        val content = linkedMapOf<String, MutableList<CloudFile>>()
        val weak = linkedMapOf<String, MutableList<CloudFile>>()
        for (file in files) {
            val hash = file.hash?.trim().orEmpty()
            if (hash.isNotEmpty() && !file.hashAlgo.isNullOrBlank()) {
                content.getOrPut("content:${file.hashAlgo}:$hash") { mutableListOf() }.add(file)
            } else if (file.size != null && file.size >= 0 && file.name.isNotBlank()) {
                val key = "weak:${file.size}:${file.name.trim().lowercase()}"
                weak.getOrPut(key) { mutableListOf() }.add(file)
            }
        }
        val groups = mutableListOf<DuplicateGroup>()
        content.forEach { (key, list) -> if (list.size > 1) groups.add(toGroup(key, "content", list)) }
        weak.forEach { (key, list) -> if (list.size > 1) groups.add(toGroup(key, "weak", list)) }
        return groups.sortedWith(compareByDescending<DuplicateGroup> { it.wastedBytes ?: 0L }.thenByDescending { it.count })
    }

    private fun toGroup(key: String, match: String, files: List<CloudFile>): DuplicateGroup {
        val firstSize = files.first().size
        val sameSize = files.all { it.size == firstSize && it.size != null }
        val wasted = if (files.any { it.size == null }) {
            null
        } else {
            val sizes = files.map { it.size ?: 0L }
            sizes.sum() - (sizes.maxOrNull() ?: 0L)
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
        val id = digest.joinToString("") { "%02x".format(it) }.take(16)
        return DuplicateGroup(
            id = id,
            match = match,
            hashAlgo = if (match == "content") files.first().hashAlgo else null,
            hash = if (match == "content") files.first().hash else null,
            count = files.size,
            size = if (sameSize) firstSize else null,
            wastedBytes = wasted,
            files = files,
        )
    }
}
