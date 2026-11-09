using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.Models;

namespace LapperRead.Tests;

public class CycleTests
{
    private static MachineState Idle = new(123, 42, false, false, false);
    private static MachineState Running = new(123, 42, true, true, true);
    private static void Observe(CycleTracker tracker, MachineState machine, string? queue = null) =>
        tracker.Observe(machine, new(null, queue), "machine", () => new() { ["m"] = 5 }, DateTimeOffset.UtcNow);

    [Fact]
    public void ActiveSerialAndPartAreLatchedWhileNextPartQueues()
    {
        var tracker = new CycleTracker(new());
        Observe(tracker, Idle, "D123456789"); Observe(tracker, Running, "D123456789");
        Observe(tracker, Running with { Ident = 999, Consec = 43 }, "D987654321");
        Observe(tracker, Idle with { Ident = 999, Consec = 43 }, "D987654321");
        var pending = Assert.Single(tracker.State.PendingCycles);
        Assert.Equal("D123456789", pending.Serial); Assert.Equal(123, pending.PartNumber); Assert.Equal(42, pending.Consec);
        Assert.Equal("D987654321", tracker.State.QueuedSerial); Assert.Equal(5, pending.Macros["m"]);
    }

    [Fact]
    public void MissingScanNeverCreatesASubstituteSerial()
    {
        var tracker = new CycleTracker(new());
        Observe(tracker, Idle); Observe(tracker, Running); Observe(tracker, Idle);
        Assert.Empty(tracker.State.PendingCycles);
    }

    [Fact]
    public void StartingDuringACycleDoesNotConsumeNextSerial()
    {
        var tracker = new CycleTracker(new());
        Observe(tracker, Running, "D123456789"); Observe(tracker, Idle, "D123456789");
        Assert.Empty(tracker.State.PendingCycles); Assert.Equal("D123456789", tracker.State.QueuedSerial);
    }

    [Fact]
    public async Task CheckpointRestoresActiveCycleAndPendingApiAcknowledgement()
    {
        using var area = new TestArea(); var store = new CycleStateStore(area.StatePath);
        var tracker = new CycleTracker(new()); Observe(tracker, Idle, "D123456789"); Observe(tracker, Running, "D123456789");
        await store.SaveAsync(tracker.State);
        tracker = new CycleTracker(await store.LoadAsync()); Observe(tracker, Idle);
        var pending = Assert.Single(tracker.State.PendingCycles); pending.SavedCycle = Fixtures.Cycle;
        await store.SaveAsync(tracker.State);
        var restored = await store.LoadAsync();
        Assert.Equal("D123456789", Assert.Single(restored.PendingCycles).Serial);
        Assert.Equal("cycle", restored.PendingCycles[0].SavedCycle!.id); Assert.Equal(5, restored.PendingCycles[0].Macros["m"]);
    }

    [Fact]
    public async Task CorruptCheckpointFailsRatherThanDiscardingRecords()
    {
        using var area = new TestArea(); await File.WriteAllTextAsync(area.StatePath, "{broken");
        await Assert.ThrowsAsync<System.Text.Json.JsonException>(() => new CycleStateStore(area.StatePath).LoadAsync());
        Assert.Equal("{broken", await File.ReadAllTextAsync(area.StatePath));
    }

    [Fact]
    public void TwoServicesCannotLeaseTheSameCheckpoint()
    {
        using var area = new TestArea(); var store = new CycleStateStore(area.StatePath);
        using (store.AcquireLease()) Assert.Throws<IOException>(() => store.AcquireLease());
        using var released = store.AcquireLease();
    }

    [Fact]
    public async Task NullPendingListIsRejectedAsAnInvalidCheckpoint()
    {
        using var area = new TestArea(); await File.WriteAllTextAsync(area.StatePath, "{\"PendingCycles\":null}");
        await Assert.ThrowsAsync<InvalidDataException>(() => new CycleStateStore(area.StatePath).LoadAsync());
    }
}
