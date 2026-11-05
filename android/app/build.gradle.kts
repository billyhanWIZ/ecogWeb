// eco.G 세척기 태블릿 껍데기 앱: 웹 화면(https://ecog.jnwiz.com/t)을 띄우고 블루투스만 앱이 직접 처리한다.
// 빌드는 GitHub Actions(.github/workflows/android.yml)가 한다. 서명 키는 저장소 Secrets 에만 둔다.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystoreFile: String? = System.getenv("ECOG_KEYSTORE_FILE")
val keystorePassword: String? = System.getenv("ECOG_KEYSTORE_PASSWORD")

android {
    namespace = "com.jnwiz.ecog.tablet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jnwiz.ecog.tablet"
        minSdk = 22 // 안드로이드 5.1 이상 (기존 Unity 앱과 같음)
        targetSdk = 35
        versionCode = (System.getenv("ECOG_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("ECOG_VERSION_NAME") ?: "1.0.0-dev"
        buildConfigField("String", "ECOG_URL", "\"https://ecog.jnwiz.com/t\"")
        buildConfigField("String", "ECOG_HOST", "\"ecog.jnwiz.com\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            if (keystoreFile != null && keystorePassword != null) {
                storeFile = file(keystoreFile)
                storePassword = keystorePassword
                keyAlias = "ecog"
                keyPassword = keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 서명 키가 없으면 디버그 키로 서명한다 (그 APK 는 다음 판으로 덮어 설치할 수 없음)
            signingConfig = if (keystoreFile != null && keystorePassword != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
