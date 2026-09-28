package com.lcdr.assistant.tools

import android.Manifest
import android.content.ContentProviderOperation
import android.content.Context
import android.os.Build
import android.provider.ContactsContract
import android.provider.ContactsContract.CommonDataKinds.Email
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.provider.ContactsContract.CommonDataKinds.StructuredName
import android.provider.Telephony
import android.telephony.PhoneNumberUtils
import android.telephony.SmsManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject
import javax.inject.Singleton

data class ContactMatch(val id: Long, val name: String, val phones: List<String>, val emails: List<String>)

@Singleton
class ContactsRepository @Inject constructor(@ApplicationContext private val context: Context) {

    fun search(query: String?, limit: Int = 25): List<ContactMatch> {
        val byId = linkedMapOf<Long, ContactMatch>()
        val selection = buildString {
            append("${ContactsContract.Data.MIMETYPE} IN (?, ?)")
            if (query != null) append(" AND (${ContactsContract.Data.DISPLAY_NAME} LIKE ? OR ${ContactsContract.Data.DATA1} LIKE ?)")
        }
        val args = buildList {
            add(Phone.CONTENT_ITEM_TYPE); add(Email.CONTENT_ITEM_TYPE)
            if (query != null) { add("%$query%"); add("%$query%") }
        }.toTypedArray()

        context.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(ContactsContract.Data.CONTACT_ID, ContactsContract.Data.DISPLAY_NAME, ContactsContract.Data.MIMETYPE, ContactsContract.Data.DATA1),
            selection, args,
            "${ContactsContract.Data.DISPLAY_NAME} COLLATE NOCASE",
        )?.use { c ->
            while (c.moveToNext()) {
                val id = c.getLong(0)
                val existing = byId[id] ?: run {
                    if (byId.size >= limit) null else ContactMatch(id, c.getString(1) ?: "", emptyList(), emptyList())
                } ?: continue
                val value = c.getString(3) ?: continue
                byId[id] = if (c.getString(2) == Phone.CONTENT_ITEM_TYPE) {
                    existing.copy(phones = (existing.phones + value).distinct())
                } else {
                    existing.copy(emails = (existing.emails + value).distinct())
                }
            }
        }
        return byId.values.toList()
    }

    fun nameForNumber(number: String): String? {
        val uri = android.net.Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, android.net.Uri.encode(number))
        return runCatching {
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null }
        }.getOrNull()
    }

    /** Resolves a phone number or a contact name to one number, or explains why it can't. */
    fun resolveNumber(target: String): Pair<String, String?> {
        val digits = target.filter { it.isDigit() || it == '+' }
        if (digits.length >= 3 && digits.length >= target.count { it.isLetterOrDigit() }) {
            return digits to nameForNumber(digits)
        }
        val matches = search(target).filter { it.phones.isNotEmpty() }
        val exact = matches.filter { it.name.equals(target, ignoreCase = true) }
        val pick = when {
            exact.size == 1 -> exact.first()
            matches.size == 1 -> matches.first()
            matches.isEmpty() -> throw ToolException("No contact with a phone number matches '$target'.")
            else -> throw ToolException(
                "'$target' is ambiguous: " + matches.take(8).joinToString("; ") { "${it.name} (${it.phones.first()})" }
            )
        }
        return pick.phones.first() to pick.name
    }

    fun upsert(name: String, phone: String?, email: String?): String {
        val existing = search(name).firstOrNull { it.name.equals(name, ignoreCase = true) }
        val ops = arrayListOf<ContentProviderOperation>()
        if (existing == null) {
            ops += ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                .build()
            ops += ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                .withValue(ContactsContract.Data.MIMETYPE, StructuredName.CONTENT_ITEM_TYPE)
                .withValue(StructuredName.DISPLAY_NAME, name)
                .build()
            phone?.let {
                ops += ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                    .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                    .withValue(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                    .withValue(Phone.NUMBER, it)
                    .withValue(Phone.TYPE, Phone.TYPE_MOBILE)
                    .build()
            }
            email?.let {
                ops += ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                    .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, 0)
                    .withValue(ContactsContract.Data.MIMETYPE, Email.CONTENT_ITEM_TYPE)
                    .withValue(Email.ADDRESS, it)
                    .withValue(Email.TYPE, Email.TYPE_HOME)
                    .build()
            }
            context.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
            return "Created contact $name."
        }

        val rawId = context.contentResolver.query(
            ContactsContract.RawContacts.CONTENT_URI,
            arrayOf(ContactsContract.RawContacts._ID),
            "${ContactsContract.RawContacts.CONTACT_ID} = ?", arrayOf(existing.id.toString()), null,
        )?.use { if (it.moveToFirst()) it.getLong(0) else null } ?: throw ToolException("Contact $name has no editable record.")

        val added = mutableListOf<String>()
        if (phone != null && existing.phones.none { PhoneNumberUtils.compare(it, phone) }) {
            ops += ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawId)
                .withValue(ContactsContract.Data.MIMETYPE, Phone.CONTENT_ITEM_TYPE)
                .withValue(Phone.NUMBER, phone)
                .withValue(Phone.TYPE, Phone.TYPE_MOBILE)
                .build()
            added += "phone $phone"
        }
        if (email != null && existing.emails.none { it.equals(email, ignoreCase = true) }) {
            ops += ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawId)
                .withValue(ContactsContract.Data.MIMETYPE, Email.CONTENT_ITEM_TYPE)
                .withValue(Email.ADDRESS, email)
                .withValue(Email.TYPE, Email.TYPE_HOME)
                .build()
            added += "email $email"
        }
        if (ops.isEmpty()) return "Contact ${existing.name} already has those details."
        context.contentResolver.applyBatch(ContactsContract.AUTHORITY, ops)
        return "Updated ${existing.name}: added ${added.joinToString(" and ")}."
    }
}

class ReadSmsTool @Inject constructor(
    @ApplicationContext private val context: Context,
    private val contacts: ContactsRepository,
) : DeviceTool {
    override val name = "read_sms"
    override val description = "Read recent SMS messages, optionally only the thread with one contact (name or number). Newest first."
    override val category = ToolCategory.COMMUNICATIONS
    override val risk = ToolRisk.READ
    override val parameters = schema {
        string("contact", "Contact name or phone number to filter by")
        integer("limit", "Max messages (default 20, max 100)")
        boolean("unread_only", "Only unread incoming messages")
    }

    override fun requiredPermissions(args: JsonObject) =
        listOfNotNull(Manifest.permission.READ_SMS, args.str("contact")?.let { Manifest.permission.READ_CONTACTS })

    override suspend fun execute(args: JsonObject): String {
        val limit = (args.int("limit") ?: 20).coerceIn(1, 100)
        val number = args.str("contact")?.let { contacts.resolveNumber(it).first }
        val tail = number?.filter(Char::isDigit)?.takeLast(7)

        val selection = mutableListOf<String>()
        val selArgs = mutableListOf<String>()
        if (tail != null) { selection += "${Telephony.Sms.ADDRESS} LIKE ?"; selArgs += "%$tail" }
        if (args.bool("unread_only") == true) selection += "${Telephony.Sms.READ} = 0 AND ${Telephony.Sms.TYPE} = ${Telephony.Sms.MESSAGE_TYPE_INBOX}"

        val names = mutableMapOf<String, String?>()
        val lines = mutableListOf<String>()
        context.contentResolver.query(
            Telephony.Sms.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.READ),
            selection.joinToString(" AND ").ifEmpty { null },
            selArgs.toTypedArray().ifEmpty { null },
            "${Telephony.Sms.DATE} DESC LIMIT $limit",
        )?.use { c ->
            while (c.moveToNext()) {
                val address = c.getString(0) ?: "?"
                val who = names.getOrPut(address) { contacts.nameForNumber(address) }?.let { "$it ($address)" } ?: address
                val direction = if (c.getInt(3) == Telephony.Sms.MESSAGE_TYPE_INBOX) "from" else "to"
                val unread = if (c.getInt(4) == 0 && direction == "from") " [unread]" else ""
                lines += "[${Formatting.millis(c.getLong(2))}] $direction $who$unread: ${c.getString(1)}"
            }
        }
        return if (lines.isEmpty()) "No messages found." else Formatting.truncate(lines.joinToString("\n"))
    }
}

class SendSmsTool @Inject constructor(
    @ApplicationContext private val context: Context,
    private val contacts: ContactsRepository,
) : DeviceTool {
    override val name = "send_sms"
    override val description =
        "Send an SMS. 'to' is a phone number or contact name; separate multiple recipients with commas. The owner confirms on-device before it is sent."
    override val category = ToolCategory.COMMUNICATIONS
    override val risk = ToolRisk.DESTRUCTIVE
    override val parameters = schema {
        string("to", "Recipient phone number(s) or contact name(s), comma-separated", required = true)
        string("message", "Message text", required = true)
    }

    override fun requiredPermissions(args: JsonObject) =
        listOf(Manifest.permission.SEND_SMS, Manifest.permission.READ_CONTACTS)

    private fun recipients(args: JsonObject) =
        args.requireStr("to").split(',', ';').map { it.trim() }.filter { it.isNotEmpty() }.map(contacts::resolveNumber)

    override suspend fun confirmation(args: JsonObject): String {
        val to = recipients(args).joinToString(", ") { (number, name) -> name?.let { "$it ($number)" } ?: number }
        val count = if (to.contains(',')) " to ${recipients(args).size} recipients" else ""
        return "Send SMS$count → $to:\n\n\"${args.requireStr("message")}\""
    }

    override suspend fun execute(args: JsonObject): String {
        val message = args.requireStr("message")
        val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION") SmsManager.getDefault()
        }
        val sent = recipients(args).map { (number, name) ->
            sms.sendMultipartTextMessage(number, null, sms.divideMessage(message), null, null)
            name ?: number
        }
        return "Sent to ${sent.joinToString(", ")}."
    }
}

class ReadContactsTool @Inject constructor(private val contacts: ContactsRepository) : DeviceTool {
    override val name = "read_contacts"
    override val description = "Search contacts by name, number or email. Omit query to list contacts."
    override val category = ToolCategory.COMMUNICATIONS
    override val risk = ToolRisk.READ
    override val parameters = schema {
        string("query", "Name, number or email fragment")
        integer("limit", "Max contacts (default 25)")
    }

    override fun requiredPermissions(args: JsonObject) = listOf(Manifest.permission.READ_CONTACTS)

    override suspend fun execute(args: JsonObject): String {
        val found = contacts.search(args.str("query"), (args.int("limit") ?: 25).coerceIn(1, 200))
        if (found.isEmpty()) return "No matching contacts."
        return found.joinToString("\n") { c ->
            buildString {
                append(c.name)
                if (c.phones.isNotEmpty()) append(" | phone: ").append(c.phones.joinToString(", "))
                if (c.emails.isNotEmpty()) append(" | email: ").append(c.emails.joinToString(", "))
            }
        }
    }
}

class WriteContactTool @Inject constructor(private val contacts: ContactsRepository) : DeviceTool {
    override val name = "write_contact"
    override val description = "Add a contact, or add a phone/email to an existing contact with the same name."
    override val category = ToolCategory.COMMUNICATIONS
    override val risk = ToolRisk.WRITE
    override val parameters = schema {
        string("name", "Full display name", required = true)
        string("phone", "Phone number")
        string("email", "Email address")
    }

    override fun requiredPermissions(args: JsonObject) =
        listOf(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)

    override suspend fun execute(args: JsonObject): String {
        val phone = args.str("phone")
        val email = args.str("email")
        if (phone == null && email == null) throw ToolException("Provide a phone or an email.")
        return contacts.upsert(args.requireStr("name"), phone, email)
    }
}
