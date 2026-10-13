package com.njg.clouddupecleaner

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class DuplicateFinderTest {
    @Test
    fun contentHashesStayInsideOneAlgorithm() {
        val groups = DuplicateFinder.find(
            listOf(
                cloudFile("dropbox", "a", "one.bin", "/one.bin", 10, "same", "dropbox-content-hash"),
                cloudFile("dropbox", "b", "two.bin", "/two.bin", 10, "same", "dropbox-content-hash"),
                cloudFile("gdrive", "c", "three.bin", "three.bin", 10, "same", "md5"),
            ),
        )
        assertEquals(1, groups.size)
        assertEquals("content", groups[0].match)
        assertEquals("dropbox-content-hash", groups[0].hashAlgo)
        assertEquals(10L, groups[0].wastedBytes)
    }

    @Test
    fun nameAndSizeAreTheFallback() {
        val groups = DuplicateFinder.find(
            listOf(
                cloudFile("onedrive", "a", "Notes.TXT", "/a", 40, null, null),
                cloudFile("onedrive", "b", "notes.txt", "/b", 40, null, null),
                cloudFile("gdrive", "c", "notes.txt", "notes.txt", 40, "abc", "md5"),
            ),
        )
        assertEquals(1, groups.size)
        assertEquals("weak", groups[0].match)
        assertEquals(2, groups[0].count)
    }
}

class TrashPolicyTest {
    @Test
    fun keepsOneCopyAndRefusesPhotos() {
        val groups = DuplicateFinder.find(MockLibrary.seed())
        val holiday = groups.first { it.hashAlgo == "dropbox-content-hash" }
        assertFailsWith<PolicyException> {
            TrashPolicy.plan(groups, holiday.files.map { it.id }, TrashPolicy.TRASH_CONFIRMATION)
        }.also { assertEquals("must_keep_one", it.code) }
        val planned = TrashPolicy.plan(groups, listOf(holiday.files[1].id), TrashPolicy.TRASH_CONFIRMATION)
        assertEquals(1, planned.size)
        val photos = groups.first { it.files.all { file -> file.provider == "gphotos" } }
        assertFailsWith<PolicyException> {
            TrashPolicy.plan(groups, listOf(photos.files[1].id), TrashPolicy.TRASH_CONFIRMATION)
        }.also { assertEquals("photos_cannot_trash", it.code) }
        assertFailsWith<PolicyException> {
            TrashPolicy.plan(groups, listOf(holiday.files[1].id), "delete")
        }.also { assertEquals("confirmation_required", it.code) }
    }

    @Test
    fun mockTrashDoesNotRemovePhotos() {
        val library = MockLibrary()
        val photos = library.files.first { it.provider == "gphotos" }
        assertFailsWith<PolicyException> { library.trash(photos) }
        library.addToReviewAlbum(listOf(photos))
        assertEquals(1, library.albums.size)
        assertTrue(library.files.any { it.id == photos.id })
        val dropbox = library.files.first { it.id == "dropbox:dbx-holiday-b" }
        library.trash(dropbox)
        assertEquals(listOf(dropbox.id), library.trash.map { it.id })
    }
}

class OAuthTest {
    @Test
    fun pkceAndRedirects() {
        val pkce = Pkce.create()
        assertEquals("S256", pkce.method)
        assertTrue(pkce.verifier.length in 43..128)
        assertNotEquals(pkce.verifier, pkce.challenge)
        val allowed = "http://127.0.0.1:3000/auth/dropbox/callback"
        assertEquals(allowed, Redirects.normalize(allowed, listOf(allowed)))
        assertFailsWith<PolicyException> {
            Redirects.normalize("https://evil.example/auth/dropbox/callback", listOf(allowed))
        }
        val url = AuthorizeUrl.build("dropbox", "client", allowed, "state", pkce.challenge, listOf("files.metadata.read"))
        assertTrue(url.startsWith("https://www.dropbox.com/oauth2/authorize?"))
        assertTrue(url.contains("response_type=code"))
        assertTrue(url.contains("code_challenge_method=S256"))
        assertTrue(!url.contains("client_secret"))
    }
}
