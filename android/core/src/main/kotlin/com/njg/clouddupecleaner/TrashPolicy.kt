package com.njg.clouddupecleaner

class PolicyException(val code: String, message: String) : IllegalArgumentException(message)

object TrashPolicy {
    const val TRASH_CONFIRMATION = "MOVE_TO_TRASH"
    const val ALBUM_CONFIRMATION = "ADD_TO_REVIEW_ALBUM"
    val photosManualSteps = listOf(
        "Open the Google Photos app or photos.google.com.",
        "Search for the file name shown in this group.",
        "Move the extra copies to Google Photos trash yourself. The Photos Library API cannot trash or delete library items.",
        "Items stay in Google Photos trash for 60 days before Google removes them.",
    )

    fun plan(groups: List<DuplicateGroup>, ids: List<String>, confirmation: String): List<CloudFile> {
        if (confirmation != TRASH_CONFIRMATION) {
            throw PolicyException("confirmation_required", "Confirm that these files should be moved to trash.")
        }
        if (ids.isEmpty() || ids.size > 200 || ids.toSet().size != ids.size) {
            throw PolicyException("nothing_selected", "Select at least one duplicate to move to trash.")
        }
        val known = groups.flatMap { it.files }.associateBy { it.id }
        if (ids.any { it !in known }) {
            throw PolicyException("unknown_file", "That file is not in the latest scan.")
        }
        val planned = mutableListOf<CloudFile>()
        for (group in groups) {
            val selected = group.files.filter { it.id in ids }
            if (selected.isEmpty()) continue
            if (selected.size >= group.files.size) {
                throw PolicyException("must_keep_one", "Leave at least one copy in each duplicate group.")
            }
            if (selected.any { !it.trashable || it.provider == "gphotos" }) {
                throw PolicyException("photos_cannot_trash", "Photos cannot be moved to trash by this app.")
            }
            planned.addAll(selected)
        }
        if (planned.isEmpty()) throw PolicyException("nothing_selected", "Select at least one duplicate to move to trash.")
        return planned
    }
}

class MockLibrary(files: List<CloudFile> = seed()) {
    val files = files.toMutableList()
    val trash = mutableListOf<CloudFile>()
    val albums = mutableListOf<List<String>>()

    fun trash(file: CloudFile) {
        if (file.provider == "gphotos" || !file.trashable) {
            throw PolicyException("photos_cannot_trash", "Photos cannot be moved to trash by this app.")
        }
        val removed = files.find { it.id == file.id } ?: throw PolicyException("not_found", "That file is gone.")
        files.remove(removed)
        trash.add(removed)
    }

    fun addToReviewAlbum(selected: List<CloudFile>) {
        val photos = selected.filter { it.provider == "gphotos" }
        if (photos.isEmpty()) throw PolicyException("no_photos", "Choose Google Photos items.")
        albums.add(photos.map { it.id })
    }

    companion object {
        fun seed(): List<CloudFile> = listOf(
            cloudFile("dropbox", "dbx-holiday-a", "holiday.jpg", "/Photos/2024/holiday.jpg", 2400000, "c0ffeeholiday", "dropbox-content-hash", "2024-07-12T15:04:00Z", "holiday"),
            cloudFile("dropbox", "dbx-holiday-b", "holiday-copy.jpg", "/Photos/2024/copies/holiday-copy.jpg", 2400000, "c0ffeeholiday", "dropbox-content-hash", "2024-08-02T09:18:00Z", "holiday"),
            cloudFile("gdrive", "drv-nda-a", "nda.pdf", "Contracts/nda.pdf", 88000, "0a11ce0a", "md5", "2023-11-03T18:00:00Z"),
            cloudFile("gdrive", "drv-nda-b", "nda-final.pdf", "Contracts/archive/nda-final.pdf", 88000, "0a11ce0a", "md5", "2024-01-19T11:40:00Z"),
            cloudFile("onedrive", "od-budget-a", "budget.xlsx", "/Documents/budget.xlsx", 56000, "a1b2c3d4e5f60789", "sha1", "2024-03-01T08:12:00Z"),
            cloudFile("onedrive", "od-budget-b", "budget (1).xlsx", "/Documents/budget (1).xlsx", 56000, "a1b2c3d4e5f60789", "sha1", "2024-03-01T08:40:00Z"),
            cloudFile("onedrive", "od-notes-a", "notes.txt", "/Notes/notes.txt", 4096, null, null, "2024-05-22T16:05:00Z"),
            cloudFile("onedrive", "od-notes-b", "notes.txt", "/Backup/notes.txt", 4096, null, null, "2024-06-01T07:55:00Z"),
            cloudFile("gphotos", "ph-img-a", "IMG_2048.JPG", "/IMG_2048.JPG", 3100000, null, null, "2024-09-14T13:22:00Z", "camera"),
            cloudFile("gphotos", "ph-img-b", "IMG_2048.JPG", "/Albums/Camera/IMG_2048.JPG", 3100000, null, null, "2024-09-14T13:22:00Z", "camera"),
            cloudFile("dropbox", "dbx-unique", "readme.txt", "/readme.txt", 1280, "deadbeef", "dropbox-content-hash"),
            cloudFile("gphotos", "ph-nosize", "clip.mp4", "/clip.mp4", null, null, null),
            cloudFile("onedrive", "od-qx-a", "reel.mov", "/Video/reel.mov", 900000, "qxhash123", "quickXor"),
            cloudFile("onedrive", "od-qx-b", "reel-copy.mov", "/Video/copies/reel-copy.mov", 900000, "qxhash123", "quickXor"),
        )
    }
}
