package com.njg.clouddupecleaner

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore

interface TokenStore {
    fun put(key: String, value: String)
    fun get(key: String): String?
    fun delete(key: String)
}

/**
 * Tokens are encrypted with a master key that lives in the Android Keystore.
 * There is no plaintext SharedPreferences fallback.
 */
class SecureTokenStore private constructor(private val prefs: SharedPreferences) : TokenStore {
    override fun put(key: String, value: String) {
        synchronized(prefs) { prefs.edit().putString(key, value).apply() }
    }

    override fun get(key: String): String? = synchronized(prefs) { prefs.getString(key, null) }

    override fun delete(key: String) {
        synchronized(prefs) { prefs.edit().remove(key).apply() }
    }

    companion object {
        fun open(context: Context): SecureTokenStore {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val masterKey = MasterKey.Builder(context.applicationContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val prefs = EncryptedSharedPreferences.create(
                context.applicationContext,
                "secure_tokens",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            return SecureTokenStore(prefs)
        }
    }
}

/** Process-only store used when the Keystore cannot be opened. Nothing is written to disk. */
class MemoryTokenStore : TokenStore {
    private val values = mutableMapOf<String, String>()
    override fun put(key: String, value: String) { synchronized(values) { values[key] = value } }
    override fun get(key: String): String? = synchronized(values) { values[key] }
    override fun delete(key: String) { synchronized(values) { values.remove(key) } }
}
