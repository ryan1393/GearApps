using System.Collections.Concurrent;
using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LapperRead.Tests;

public class WorkerTests
{
    private static readonly MachineState Idle = new(123, 42, false, false, false);
    private static readonly MachineState Running = new(123, 42, true, true, true);

    private sealed class Controller(params MachineState[] rows) : IFanuc
    {
        public int Step = -1, Reads, ReadFailures, PersistFailures;
        public Func<int, bool>? CanAdvance;
        public TaskCompletionSource? PublishGate;
        public ConcurrentQueue<Dictionary<string, decimal>> Saved = new();
        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public MachineState ReadState()
        {
            Interlocked.Increment(ref Reads);
            if (Interlocked.Decrement(ref ReadFailures) >= 0) throw new IOException("Simulated machine outage");
            var next = Math.Min(Step + 1, rows.Length - 1);
            if (CanAdvance?.Invoke(next) != false) Step = next;
            return rows[Step];
        }
        public string? GetMacroValue(short number) => "5";
        public Dictionary<string, decimal> CaptureMacros() => new() { ["m"] = 5 };
        public async Task PersistMacrosAsync(MachineCycle cycle, IReadOnlyDictionary<string, decimal> values, string requestId, CancellationToken cancellationToken = default)
        {
            if (PublishGate != null) await PublishGate.Task.WaitAsync(cancellationToken);
            if (Interlocked.Decrement(ref PersistFailures) >= 0) throw new HttpRequestException("Simulated macro outage");
            Saved.Enqueue(new(values));
        }
        public void Dispose() { }
    }

    private sealed class Reader(Controller controller, bool fail = false) : IScanners
    {
        public Task<ScannerState> ReadAsync(ScannerState previous, CancellationToken cancellationToken = default)
        {
            if (fail) throw new IOException("Simulated scanner outage");
            return Task.FromResult(controller.Step switch { 0 => previous with { Queue = "D123456789" }, 2 => previous with { Queue = "D987654321" }, _ => previous });
        }
        public Task<string> Input2Async(string command, CancellationToken cancellationToken = default) => Task.FromResult("OFF");
        public void Dispose() { }
    }

    private static Worker Service(TestArea area, DatabaseDouble database, Controller controller, bool scannerFails = false) =>
        new(NullLogger<Worker>.Instance, Options.Create(new LapperConfiguration
        {
            MachineIp = "127.0.0.1", ScannerIp = "127.0.0.1", PollIntervalMilliseconds = 10, RetryDelayMilliseconds = 40
        }), new Reader(controller, scannerFails), controller, database, new CycleStateStore(area.StatePath));

    private static async Task Until(Func<bool> condition, Worker worker)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition())
        {
            if (worker.ExecuteTask?.IsFaulted == true) await worker.ExecuteTask;
            await Task.Delay(5, deadline.Token);
        }
    }
    private static async Task Stop(Worker worker)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await worker.StopAsync(deadline.Token);
        Assert.True(worker.ExecuteTask!.IsCompleted);
    }

    [Fact]
    public async Task RealWorkerLatchesSerialAndPublishesPostTransitionState()
    {
        using var area = new TestArea(); var database = new DatabaseDouble(); var controller = new Controller(Idle, Running, Running, Idle);
        controller.CanAdvance = next => next != 3 || database.ScannerWrites.Any(row => row.Process == "D123456789");
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try
        {
            await Until(() => controller.Saved.Count == 1, worker);
            Assert.Equal("D123456789", Assert.Single(database.Cycles).Serial);
            Assert.Contains(database.ScannerWrites, row => row.Process == "D123456789" && row.Queue != "D123456789");
        }
        finally { await Stop(worker); }
    }

    [Fact]
    public async Task CyclePostFailureIsRetriedWithoutLosingOrReassigningTheSerial()
    {
        using var area = new TestArea(); var database = new DatabaseDouble { CycleFailures = 2 }; var controller = new Controller(Idle, Running, Running, Idle);
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try
        {
            await Until(() => controller.Saved.Count == 1, worker);
            Assert.Equal(3, database.CycleAttempts); Assert.Equal("D123456789", Assert.Single(database.Cycles).Serial);
            Assert.Equal(5, Assert.Single(controller.Saved)["m"]);
        }
        finally { await Stop(worker); }
    }

    [Fact]
    public async Task MacroRetryDoesNotRecreateAnAcknowledgedCycle()
    {
        using var area = new TestArea(); var database = new DatabaseDouble(); var controller = new Controller(Idle, Running, Running, Idle) { PersistFailures = 2 };
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try { await Until(() => controller.Saved.Count == 1, worker); Assert.Equal(1, database.CycleAttempts); }
        finally { await Stop(worker); }
    }

    [Fact]
    public async Task RestartReplaysCheckpointedValuesWithoutRepostingSavedCycle()
    {
        using var area = new TestArea(); var database = new DatabaseDouble(); var controller = new Controller(Idle);
        await new CycleStateStore(area.StatePath).SaveAsync(new CycleState
        {
            WasInCycle = false, PendingCycles = [new PendingCycle
            {
                Serial = "D123456789", MachineId = "machine", PartNumber = 123, Consec = 42,
                SavedCycle = Fixtures.Cycle, Macros = new() { ["m"] = 17 }, CompletedAt = DateTimeOffset.UtcNow
            }]
        });
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try { await Until(() => controller.Saved.Count == 1, worker); Assert.Equal(17, Assert.Single(controller.Saved)["m"]); Assert.Equal(0, database.CycleAttempts); }
        finally { await Stop(worker); }
        Assert.Empty((await new CycleStateStore(area.StatePath).LoadAsync()).PendingCycles);
    }

    [Fact]
    public async Task BlockedApiPublishingDoesNotBlockMachinePolling()
    {
        using var area = new TestArea(); var database = new DatabaseDouble(); var controller = new Controller(Idle, Running, Running, Idle)
            { PublishGate = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try
        {
            await Until(() => database.Cycles.Count == 1, worker); var reads = controller.Reads;
            await Until(() => controller.Reads >= reads + 4, worker); Assert.Empty(controller.Saved);
        }
        finally { await Stop(worker); }
        Assert.Single((await new CycleStateStore(area.StatePath).LoadAsync()).PendingCycles);
    }

    [Fact]
    public async Task ScannerOutagePreservesTheKnownQueuedSerialAndWorkerSurvives()
    {
        using var area = new TestArea(); await new CycleStateStore(area.StatePath).SaveAsync(new CycleState { WasInCycle = false, QueuedSerial = "D123456789" });
        var database = new DatabaseDouble(); var controller = new Controller(Idle, Running, Running, Idle);
        using var worker = Service(area, database, controller, scannerFails: true); await worker.StartAsync(default);
        try { await Until(() => controller.Saved.Count == 1, worker); Assert.Equal("D123456789", Assert.Single(database.Cycles).Serial); }
        finally { await Stop(worker); }
    }

    [Fact]
    public async Task ShutdownCancelsAnUnavailableMachineRetry()
    {
        using var area = new TestArea(); var controller = new Controller(Idle) { ReadFailures = int.MaxValue };
        using var worker = Service(area, new DatabaseDouble(), controller); await worker.StartAsync(default);
        await Until(() => controller.Reads > 0, worker); await Stop(worker);
    }

    [Fact]
    public async Task StoppingDuringAnActiveCycleKeepsItsSerialForRestart()
    {
        using var area = new TestArea(); var database = new DatabaseDouble(); var controller = new Controller(Idle, Running, Running);
        using var worker = Service(area, database, controller); await worker.StartAsync(default);
        try { await Until(() => database.ScannerWrites.Any(row => row.Process == "D123456789" && row.Queue == "D987654321"), worker); }
        finally { await Stop(worker); }
        var checkpoint = await new CycleStateStore(area.StatePath).LoadAsync();
        Assert.Equal("D123456789", checkpoint.ActiveCycle!.Serial); Assert.Equal("D987654321", checkpoint.QueuedSerial);
    }
}
