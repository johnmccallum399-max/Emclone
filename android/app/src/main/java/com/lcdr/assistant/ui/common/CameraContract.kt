package com.lcdr.assistant.ui.common

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.contract.ActivityResultContract

/** TakePicture with a best-effort front-camera hint (honoured by most stock camera apps). */
class CapturePhoto : ActivityResultContract<Pair<Uri, Boolean>, Boolean>() {
    override fun createIntent(context: Context, input: Pair<Uri, Boolean>): Intent =
        Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, input.first)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply {
                if (input.second) {
                    putExtra("android.intent.extras.CAMERA_FACING", 1)
                    putExtra("android.intent.extras.LENS_FACING_FRONT", 1)
                    putExtra("android.intent.extra.USE_FRONT_CAMERA", true)
                }
            }

    override fun parseResult(resultCode: Int, intent: Intent?) = resultCode == android.app.Activity.RESULT_OK
}
