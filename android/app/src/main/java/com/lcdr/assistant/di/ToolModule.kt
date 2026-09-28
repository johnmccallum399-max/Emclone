package com.lcdr.assistant.di

import com.lcdr.assistant.tools.CreateEventTool
import com.lcdr.assistant.tools.DeleteEventTool
import com.lcdr.assistant.tools.DeviceTool
import com.lcdr.assistant.tools.GetBatteryTool
import com.lcdr.assistant.tools.GetClipboardTool
import com.lcdr.assistant.tools.GetLocationTool
import com.lcdr.assistant.tools.GetRunningAppsTool
import com.lcdr.assistant.tools.HubCreateSessionTool
import com.lcdr.assistant.tools.HubListAgentsTool
import com.lcdr.assistant.tools.HubRunSessionTool
import com.lcdr.assistant.tools.ListEventsTool
import com.lcdr.assistant.tools.ListFilesTool
import com.lcdr.assistant.tools.OpenFileTool
import com.lcdr.assistant.tools.ReadContactsTool
import com.lcdr.assistant.tools.ReadFileTool
import com.lcdr.assistant.tools.ReadSmsTool
import com.lcdr.assistant.tools.SendNotificationTool
import com.lcdr.assistant.tools.SendSmsTool
import com.lcdr.assistant.tools.SetAlarmTool
import com.lcdr.assistant.tools.SetClipboardTool
import com.lcdr.assistant.tools.SetTimerTool
import com.lcdr.assistant.tools.TakePhotoTool
import com.lcdr.assistant.tools.WriteContactTool
import com.lcdr.assistant.tools.WriteFileTool
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import dagger.multibindings.IntoSet

/** Every device tool the model can call. Add a tool: implement DeviceTool, bind it here. */
@Module
@InstallIn(SingletonComponent::class)
abstract class ToolModule {
    @Binds @IntoSet abstract fun readSms(t: ReadSmsTool): DeviceTool
    @Binds @IntoSet abstract fun sendSms(t: SendSmsTool): DeviceTool
    @Binds @IntoSet abstract fun readContacts(t: ReadContactsTool): DeviceTool
    @Binds @IntoSet abstract fun writeContact(t: WriteContactTool): DeviceTool

    @Binds @IntoSet abstract fun listEvents(t: ListEventsTool): DeviceTool
    @Binds @IntoSet abstract fun createEvent(t: CreateEventTool): DeviceTool
    @Binds @IntoSet abstract fun deleteEvent(t: DeleteEventTool): DeviceTool

    @Binds @IntoSet abstract fun listFiles(t: ListFilesTool): DeviceTool
    @Binds @IntoSet abstract fun readFile(t: ReadFileTool): DeviceTool
    @Binds @IntoSet abstract fun writeFile(t: WriteFileTool): DeviceTool
    @Binds @IntoSet abstract fun openFile(t: OpenFileTool): DeviceTool

    @Binds @IntoSet abstract fun battery(t: GetBatteryTool): DeviceTool
    @Binds @IntoSet abstract fun location(t: GetLocationTool): DeviceTool
    @Binds @IntoSet abstract fun alarm(t: SetAlarmTool): DeviceTool
    @Binds @IntoSet abstract fun timer(t: SetTimerTool): DeviceTool
    @Binds @IntoSet abstract fun photo(t: TakePhotoTool): DeviceTool
    @Binds @IntoSet abstract fun getClipboard(t: GetClipboardTool): DeviceTool
    @Binds @IntoSet abstract fun setClipboard(t: SetClipboardTool): DeviceTool
    @Binds @IntoSet abstract fun notification(t: SendNotificationTool): DeviceTool
    @Binds @IntoSet abstract fun runningApps(t: GetRunningAppsTool): DeviceTool

    @Binds @IntoSet abstract fun hubAgents(t: HubListAgentsTool): DeviceTool
    @Binds @IntoSet abstract fun hubCreate(t: HubCreateSessionTool): DeviceTool
    @Binds @IntoSet abstract fun hubRun(t: HubRunSessionTool): DeviceTool
}
