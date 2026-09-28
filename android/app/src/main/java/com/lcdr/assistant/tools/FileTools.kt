package com.lcdr.assistant.tools

import android.Manifest
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.JsonObject
import java.io.File
import javax.inject.Inject

/** Relative paths resolve against shared storage root (/storage/emulated/0). */
internal object StoragePaths {
    val root: File get() = Environment.getExternalStorageDirectory()

    fun resolve(path: String?): File {
        val p = path?.trim().orEmpty()
        val file = when {
            p.isEmpty() || p == "/" || p == "~" -> root
            p.startsWith("/") -> File(p)
            p.startsWith("~/") -> File(root, p.removePrefix("~/"))
            else -> File(root, p)
        }
        return file.canonicalFile
    }

    fun display(file: File) = file.path.removePrefix(root.path).ifEmpty { "/" }

    fun legacyPermissions(write: Boolean): List<String> = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> emptyList()
        write -> listOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
        else -> listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    fun specialAccess(): SpecialAccess? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) SpecialAccess.ALL_FILES else null
}

class ListFilesTool @Inject constructor() : DeviceTool {
    override val name = "list_files"
    override val description = "List a directory in device storage. Relative paths start at shared storage root (e.g. 'Download')."
    override val category = ToolCategory.FILES
    override val risk = ToolRisk.READ
    override val parameters = schema { string("path", "Directory path; empty for storage root") }

    override fun requiredPermissions(args: JsonObject) = StoragePaths.legacyPermissions(write = false)
    override fun specialAccess(args: JsonObject) = StoragePaths.specialAccess()

    override suspend fun execute(args: JsonObject): String {
        val dir = StoragePaths.resolve(args.str("path"))
        if (!dir.isDirectory) throw ToolException("Not a directory: ${dir.path}")
        val entries = dir.listFiles()?.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
            ?: throw ToolException("Cannot read ${dir.path}")
        if (entries.isEmpty()) return "${StoragePaths.display(dir)} is empty."
        val shown = entries.take(200).joinToString("\n") { f ->
            if (f.isDirectory) "${f.name}/" else "${f.name}  (${f.length()} B, ${Formatting.millis(f.lastModified())})"
        }
        val more = if (entries.size > 200) "\n…and ${entries.size - 200} more" else ""
        return "${StoragePaths.display(dir)}:\n$shown$more"
    }
}

class ReadFileTool @Inject constructor() : DeviceTool {
    override val name = "read_file"
    override val description = "Read a text file from device storage."
    override val category = ToolCategory.FILES
    override val risk = ToolRisk.READ
    override val parameters = schema {
        string("path", "File path", required = true)
        integer("max_chars", "Max characters to return (default 20000)")
    }

    override fun requiredPermissions(args: JsonObject) = StoragePaths.legacyPermissions(write = false)
    override fun specialAccess(args: JsonObject) = StoragePaths.specialAccess()

    override suspend fun execute(args: JsonObject): String {
        val file = StoragePaths.resolve(args.requireStr("path"))
        if (!file.isFile) throw ToolException("No such file: ${file.path}")
        if (file.length() > 10L * 1024 * 1024) throw ToolException("File is larger than 10 MB; open it instead.")
        val bytes = file.readBytes()
        if (bytes.take(8000).any { it == 0.toByte() }) throw ToolException("Binary file; use open_file.")
        return Formatting.truncate(String(bytes, Charsets.UTF_8), (args.int("max_chars") ?: 20_000).coerceIn(100, 100_000))
    }
}

class WriteFileTool @Inject constructor() : DeviceTool {
    override val name = "write_file"
    override val description = "Write text to a file (creates parent folders). Overwriting an existing file asks the owner first."
    override val category = ToolCategory.FILES
    override val risk = ToolRisk.DESTRUCTIVE
    override val parameters = schema {
        string("path", "File path", required = true)
        string("content", "Text content", required = true)
        boolean("append", "Append instead of overwrite")
    }

    override fun requiredPermissions(args: JsonObject) = StoragePaths.legacyPermissions(write = true)
    override fun specialAccess(args: JsonObject) = StoragePaths.specialAccess()

    override suspend fun confirmation(args: JsonObject): String? {
        val file = StoragePaths.resolve(args.requireStr("path"))
        return if (file.exists() && args.bool("append") != true) {
            "Overwrite ${StoragePaths.display(file)} (${file.length()} bytes)?"
        } else {
            null
        }
    }

    override suspend fun execute(args: JsonObject): String {
        val file = StoragePaths.resolve(args.requireStr("path"))
        file.parentFile?.mkdirs()
        val content = args.requireStr("content")
        if (args.bool("append") == true) file.appendText(content) else file.writeText(content)
        return "Wrote ${content.length} chars to ${StoragePaths.display(file)}."
    }
}

class OpenFileTool @Inject constructor(@ApplicationContext private val context: Context) : DeviceTool {
    override val name = "open_file"
    override val description = "Open a file with the system app chooser (view/share)."
    override val category = ToolCategory.FILES
    override val risk = ToolRisk.READ
    override val parameters = schema { string("path", "File path", required = true) }

    override fun requiredPermissions(args: JsonObject) = StoragePaths.legacyPermissions(write = false)
    override fun specialAccess(args: JsonObject) = StoragePaths.specialAccess()

    override suspend fun execute(args: JsonObject): String {
        val file = StoragePaths.resolve(args.requireStr("path"))
        if (!file.isFile) throw ToolException("No such file: ${file.path}")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(
            Intent.createChooser(view, file.name).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        )
        return "Opened ${file.name} in the app chooser."
    }
}
