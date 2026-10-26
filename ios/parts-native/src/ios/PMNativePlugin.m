#import <Cordova/CDVPlugin.h>
#import <UIKit/UIKit.h>

@interface PMNativePlugin : CDVPlugin <UIDocumentPickerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate>
@property(nonatomic, copy) NSString *pendingCallback;
@property(nonatomic, strong) NSURL *pendingDirectory;
@end

@implementation PMNativePlugin

- (void)reply:(CDVInvokedUrlCommand *)command error:(NSString *)message {
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsString:message];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}

- (NSString *)fileName:(id)value {
    if (![value isKindOfClass:NSString.class] || [value length] == 0) return nil;
    NSString *name = value;
    if (![name isEqualToString:name.lastPathComponent] || [name containsString:@"\\"] ||
        [name isEqualToString:@"."] || [name isEqualToString:@".."] ||
        [name rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location != NSNotFound) return nil;
    return name;
}

- (NSData *)decode:(id)value {
    if (![value isKindOfClass:NSString.class]) return nil;
    NSString *text = value;
    if ([text hasPrefix:@"data:"]) {
        NSRange comma = [text rangeOfString:@","];
        if (comma.location == NSNotFound) return nil;
        text = [text substringFromIndex:comma.location + 1];
    }
    return [[NSData alloc] initWithBase64EncodedString:text options:0];
}

- (void)finishPicker:(BOOL)success message:(NSString *)message {
    NSString *callback = self.pendingCallback;
    NSURL *directory = self.pendingDirectory;
    self.pendingCallback = nil;
    self.pendingDirectory = nil;
    if (directory) [NSFileManager.defaultManager removeItemAtURL:directory error:nil];
    if (callback) {
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:success ? CDVCommandStatus_OK : CDVCommandStatus_ERROR messageAsString:message];
        [self.commandDelegate sendPluginResult:result callbackId:callback];
    }
}

// The manual export acknowledges only the document picker's successful save.
- (void)saveFile:(CDVInvokedUrlCommand *)command {
    [self exportFile:command];
}

- (void)saveImage:(CDVInvokedUrlCommand *)command {
    [self exportFile:command];
}

- (void)exportFile:(CDVInvokedUrlCommand *)command {
    if (self.pendingCallback || self.viewController.presentedViewController) {
        [self reply:command error:@"请先完成当前的保存或照片选择"];
        return;
    }
    NSString *name = [self fileName:[command argumentAtIndex:1]];
    NSData *data = [self decode:[command argumentAtIndex:0]];
    if (!name || !data) { [self reply:command error:@"文件名或文件数据无效"]; return; }
    NSURL *directory = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES] URLByAppendingPathComponent:NSUUID.UUID.UUIDString isDirectory:YES];
    NSError *error;
    if (![NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error] ||
        ![data writeToURL:[directory URLByAppendingPathComponent:name] options:NSDataWritingAtomic error:&error]) {
        [NSFileManager.defaultManager removeItemAtURL:directory error:nil];
        [self reply:command error:error.localizedDescription ?: @"无法准备导出文件"];
        return;
    }
    self.pendingCallback = command.callbackId;
    self.pendingDirectory = directory;
    NSURL *file = [directory URLByAppendingPathComponent:name];
    UIDocumentPickerViewController *picker;
    if (@available(iOS 14.0, *)) picker = [[UIDocumentPickerViewController alloc] initForExportingURLs:@[file] asCopy:YES];
    else picker = [[UIDocumentPickerViewController alloc] initWithURL:file inMode:UIDocumentPickerModeExportToService];
    picker.delegate = self;
    [self.viewController presentViewController:picker animated:YES completion:nil];
}

- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
    [self finishPicker:urls.count > 0 message:urls.count > 0 ? @"已保存到所选位置" : @"保存已取消"];
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    [self finishPicker:NO message:@"保存已取消"];
}

// This file is in the app's Documents folder, not outside the iOS sandbox.
- (void)saveFileReplace:(CDVInvokedUrlCommand *)command {
    NSString *name = [self fileName:[command argumentAtIndex:1]];
    NSData *data = [self decode:[command argumentAtIndex:0]];
    if (!name || !data) { [self reply:command error:@"备份数据无效"]; return; }
    [self.commandDelegate runInBackground:^{
        NSError *error;
        NSURL *documents = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
        NSURL *directory = [documents URLByAppendingPathComponent:@"Backups" isDirectory:YES];
        BOOL saved = [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error] &&
            [data writeToURL:[directory URLByAppendingPathComponent:name] options:NSDataWritingAtomic error:&error];
        CDVPluginResult *result = [CDVPluginResult resultWithStatus:saved ? CDVCommandStatus_OK : CDVCommandStatus_ERROR
            messageAsString:saved ? @"本机备份已保存" : (error.localizedDescription ?: @"备份失败")];
        [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
    }];
}

- (void)takePicture:(CDVInvokedUrlCommand *)command {
    if (self.pendingCallback || self.viewController.presentedViewController) {
        [self reply:command error:@"请先完成当前的保存或照片选择"];
        return;
    }
    BOOL camera = [[command argumentAtIndex:0] isEqual:@"camera"];
    UIImagePickerControllerSourceType source = camera ? UIImagePickerControllerSourceTypeCamera : UIImagePickerControllerSourceTypePhotoLibrary;
    if (![UIImagePickerController isSourceTypeAvailable:source]) {
        [self reply:command error:camera ? @"当前设备无法使用相机" : @"当前设备无法使用相册"];
        return;
    }
    self.pendingCallback = command.callbackId;
    UIImagePickerController *picker = [[UIImagePickerController alloc] init];
    picker.sourceType = source;
    picker.delegate = self;
    picker.modalPresentationStyle = UIModalPresentationFullScreen;
    [self.viewController presentViewController:picker animated:YES completion:nil];
}

- (void)imagePickerController:(UIImagePickerController *)picker didFinishPickingMediaWithInfo:(NSDictionary<UIImagePickerControllerInfoKey,id> *)info {
    UIImage *image = info[UIImagePickerControllerOriginalImage];
    NSData *data = image ? UIImageJPEGRepresentation(image, 0.85) : nil;
    NSString *result = data ? [@"data:image/jpeg;base64," stringByAppendingString:[data base64EncodedStringWithOptions:0]] : @"无法读取照片";
    [picker dismissViewControllerAnimated:YES completion:^{ [self finishPicker:data != nil message:result]; }];
}

- (void)imagePickerControllerDidCancel:(UIImagePickerController *)picker {
    [picker dismissViewControllerAnimated:YES completion:^{ [self finishPicker:NO message:@"已取消照片选择"]; }];
}

- (void)onReset {
    [self finishPicker:NO message:@"页面已重新加载"];
    [super onReset];
}
@end
