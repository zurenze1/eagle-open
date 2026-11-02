// Original passive detector: drag pasteboard TYPES and button state only.
// No general clipboard, input synthesis, event tap, or permission request.
#import <AppKit/AppKit.h>
#include <unistd.h>
static dispatch_source_t parentInput;

static void emit(BOOL active) {
    pid_t owner = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
    printf("{\"active\":%s,\"ownerPID\":%d}\n", active ? "true" : "false", owner);
    fflush(stdout);
}
int main(void) { @autoreleasepool {
    NSPasteboard *board = [NSPasteboard pasteboardWithName:NSPasteboardNameDrag];
    NSSet *supported = [NSSet setWithArray:@[@"public.file-url", @"NSFilenamesPboardType", @"public.url", @"public.png", @"public.jpeg", @"public.tiff"]];
    __block NSInteger baseline = board.changeCount;
    __block BOOL active = NO;
    NSTimer *timer = [NSTimer scheduledTimerWithTimeInterval:0.08 repeats:YES block:^(NSTimer *unused) {
        @autoreleasepool {
            BOOL down = (NSEvent.pressedMouseButtons & 1) != 0;
            NSInteger count = board.changeCount;
            if (!down) {
                baseline = count;
                if (active) { active = NO; emit(NO); }
            } else if (!active && count != baseline && [supported intersectsSet:[NSSet setWithArray:board.types ?: @[]]]) {
                active = YES; emit(YES);
            }
        }
    }];
    timer.tolerance = 0.025;
    parentInput = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(parentInput, ^{ char byte; if (read(STDIN_FILENO, &byte, 1) <= 0) exit(0); });
    dispatch_resume(parentInput);
    emit(NO);
    [NSRunLoop.mainRunLoop run];
    return 0;
}}
