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
        assertTrue(url.contains("token_access_type=offline"))
        assertTrue(!url.contains("client_secret"))
    }

    @Test
    fun customSchemesAreAllowlistedExactly() {
        val dropbox = InstalledAppRedirect.DROPBOX
        val google = InstalledAppRedirect.google("1234567890-abc.apps.googleusercontent.com")
        assertEquals("com.googleusercontent.apps.1234567890-abc:/oauth2redirect", google)
        val allow = listOf(dropbox, google)
        assertEquals(dropbox, Redirects.normalize(dropbox, allow))
        assertEquals(google, Redirects.normalize(google, allow))
        val rejected = listOf(
            dropbox,
            "clouddupecleaner://oauth/extra",
            "clouddupecleaner://oauth?code=1",
            "clouddupecleaner://evil",
            "myapp://oauth",
            "com.googleusercontent.apps.not-valid:/oauth2redirect",
            "com.googleusercontent.apps.1234567890-abc://oauth2redirect",
            "javascript:alert(1)",
        )
        rejected.drop(1).forEach { uri ->
            assertFailsWith<PolicyException> { Redirects.normalize(uri, rejected) }
        }
        assertFailsWith<PolicyException> { Redirects.normalize(dropbox, listOf("http://127.0.0.1:3000/callback")) }
        val drive = AuthorizeUrl.build(
            "gdrive",
            "1234567890-abc.apps.googleusercontent.com",
            google,
            "state",
            "challenge",
            ProviderScopes.connect("gdrive"),
        )
        assertTrue(drive.contains("access_type=offline"))
        assertTrue(drive.contains("code_challenge_method=S256"))
        assertTrue(!drive.contains("client_secret"))
        assertTrue(drive.contains("drive.readonly"))
        assertTrue(!drive.contains("auth%2Fdrive&") && !drive.contains("scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive&"))
    }
}

class DriveDropboxTest {
    @Test
    fun tokenExchangeHasNoSecret() {
        val call = DriveDropbox.authorizationCode(
            "dropbox",
            "app-key",
            "auth-code",
            InstalledAppRedirect.DROPBOX,
            "a".repeat(43),
        )
        assertEquals("https://api.dropboxapi.com/oauth2/token", call.url)
        assertTrue(call.body!!.contains("grant_type=authorization_code"))
        assertTrue(call.body!!.contains("code_verifier="))
        assertTrue(!call.body!!.contains("client_secret"))
        val google = DriveDropbox.refresh("gdrive", "1234567890-abc.apps.googleusercontent.com", "refresh-token")
        assertEquals("https://oauth2.googleapis.com/token", google.url)
        assertTrue(!google.body!!.contains("client_secret"))
        val parsed = DriveDropbox.parseToken(
            """{"access_token":"ya29.token","expires_in":3600,"refresh_token":"1//refresh","scope":"https://www.googleapis.com/auth/drive.readonly"}""",
        )
        assertEquals("ya29.token", parsed.accessToken)
        assertEquals(3600L, parsed.expiresInSeconds)
        assertEquals(listOf("https://www.googleapis.com/auth/drive.readonly"), parsed.scopes)
    }

    @Test
    fun listingThumbnailsAndTrashStayOnTheSafeCalls() {
        val dropbox = DriveDropbox.parseDropbox(
            """{"entries":[{".tag":"folder","name":"Photos","id":"id:folder"},{".tag":"file","name":"holiday.jpg","id":"id:abc","size":2400000,"content_hash":"c0ffee","path_display":"/Photos/holiday.jpg","client_modified":"2024-07-12T15:04:00Z"}],"has_more":false}""",
        )
        assertEquals(1, dropbox.files.size)
        assertEquals("dropbox-content-hash", dropbox.files[0].hashAlgo)
        assertEquals("/Photos/holiday.jpg", dropbox.files[0].path)
        val thumb = DriveDropbox.thumbnail(dropbox.files[0])
        assertEquals("https://content.dropboxapi.com/2/files/get_thumbnail_v2", thumb.url)
        assertEquals("POST", thumb.method)
        val dropboxTrash = DriveDropbox.trash(dropbox.files[0])
        assertEquals("https://api.dropboxapi.com/2/files/delete_v2", dropboxTrash.url)
        assertTrue(dropboxTrash.body!!.contains("/Photos/holiday.jpg"))
        assertTrue(!dropboxTrash.url.contains("permanently_delete"))

        val drive = DriveDropbox.parseDrive(
            """{"files":[{"id":"file1","name":"nda.pdf","mimeType":"application/pdf","size":"88000","md5Checksum":"0a11ce0a","modifiedTime":"2023-11-03T18:00:00.000Z","thumbnailLink":"https://lh3.googleusercontent.com/d/file1=s220"},{"id":"folder","name":"Contracts","mimeType":"application/vnd.google-apps.folder"},{"id":"evil","name":"x.png","thumbnailLink":"https://evil.example/x.png"}]}""",
        )
        assertEquals(2, drive.files.size)
        assertEquals("md5", drive.files[0].hashAlgo)
        assertEquals("https://lh3.googleusercontent.com/d/file1=s220", drive.files[0].thumbnailUrl)
        assertEquals(null, drive.files[1].thumbnailUrl)
        val driveTrash = DriveDropbox.trash(drive.files[0])
        assertEquals("PATCH", driveTrash.method)
        assertEquals("https://www.googleapis.com/drive/v3/files/file1", driveTrash.url)
        assertEquals("""{"trashed":true}""", driveTrash.body)
        assertFailsWith<PolicyException> {
            DriveDropbox.thumbnail(cloudFile("gdrive", "x", "x.png", "x.png", 1, null, null, thumbnailUrl = "http://lh3.googleusercontent.com/x"))
        }
        assertFailsWith<PolicyException> {
            DriveDropbox.trash(cloudFile("gphotos", "p", "a.jpg", "/a.jpg", 1, null, null))
        }
        assertFailsWith<PolicyException> {
            DriveDropbox.trash(dropbox.files[0].copy(path = "/Photos/../secret.jpg"))
        }
        assertEquals(
            listOf("https://www.googleapis.com/auth/drive.readonly"),
            ProviderScopes.connect("gdrive"),
        )
        assertTrue(ProviderScopes.trash("gdrive").contains("https://www.googleapis.com/auth/drive"))
        assertTrue(!ProviderScopes.connect("dropbox").contains("files.content.write"))
    }
}
