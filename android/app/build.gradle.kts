import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

fun cdcSetting(name: String): String? {
    System.getenv(name)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    (findProperty(name) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val localFile = rootProject.file("local.properties")
    if (!localFile.isFile) return null
    val props = Properties()
    localFile.inputStream().use { props.load(it) }
    return props.getProperty(name)?.trim()?.takeIf { it.isNotEmpty() }
}

val cdcStoreFile = cdcSetting("CDC_STORE_FILE")
val cdcStorePassword = cdcSetting("CDC_STORE_PASSWORD")
val cdcKeyAlias = cdcSetting("CDC_KEY_ALIAS")
val cdcKeyPassword = cdcSetting("CDC_KEY_PASSWORD")
val hasReleaseKey = cdcStoreFile != null &&
    cdcStorePassword != null &&
    cdcKeyAlias != null &&
    cdcKeyPassword != null

android {
    namespace = "com.njg.clouddupecleaner"
    compileSdk = 35

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(cdcStoreFile!!)
                storePassword = cdcStorePassword
                keyAlias = cdcKeyAlias
                keyPassword = cdcKeyPassword
            }
        }
    }

    defaultConfig {
        applicationId = "com.njg.clouddupecleaner"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "DROPBOX_CLIENT_ID", "\"\"")
        buildConfigField("String", "ONEDRIVE_CLIENT_ID", "\"\"")
        buildConfigField("String", "GOOGLE_CLIENT_ID", "\"\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.browser:browser:1.8.0")
}
