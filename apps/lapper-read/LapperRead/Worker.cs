using System.Net.Sockets;
using LapperReadLibrary.BusinessLogic;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LapperRead;

public sealed class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly LapperConfiguration _settings;
    private readonly IScanners _scanner;
    private readonly IFanuc _fanuc;
    private readonly IDatabaseCalls _database;
    private readonly CycleStateStore _store;
    private readonly SemaphoreSlim _stateGate = new(1, 1);
    private CycleTracker _tracker = new(new CycleState());
    private Equipment _machine = null!;
    private ScannerDetail _scannerDetail = null!;
    private MachineFanucVariable _variables = null!;
    private bool _checkpointDirty;
    private Telemetry? _latestTelemetry;
    private Telemetry? _savedTelemetry;

    private sealed record Telemetry(MachineState Machine, string? Process, string? Queue, string? Scanner);

    public Worker(ILogger<Worker> logger, IOptions<LapperConfiguration> settings, IScanners scanner,
        IFanuc fanuc, IDatabaseCalls database, CycleStateStore store)
    {
        _logger = logger; _settings = settings.Value; _scanner = scanner;
        _fanuc = fanuc; _database = database; _store = store;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var lease = _store.AcquireLease();
        _tracker = new CycleTracker(await _store.LoadAsync(stoppingToken));
        try
        {
            await InitializeAsync(stoppingToken);
            // Publishing API records must not block sampling the machine or scanner.
            await Task.WhenAll(SampleAsync(stoppingToken), PublishAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            // Cancellation may have interrupted the last transition's checkpoint write.
            if (_checkpointDirty)
            {
                using var flush = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                try { await CheckpointAsync(flush.Token); }
                catch (Exception exception) { _logger.LogError(exception, "Unable to flush the final cycle checkpoint"); }
            }
            _logger.LogInformation("Lapper Read stopped; pending cycles remain in the checkpoint");
        }
    }

    private async Task InitializeAsync(CancellationToken token)
    {
        while (true)
        {
            token.ThrowIfCancellationRequested();
            try
            {
                _machine = await _database.GetMachineByIp(_settings.MachineIp, token, _settings.MachineNumber)
                    ?? throw new IOException("Machine configuration is missing.");
                _scannerDetail = await _database.GetScannerByIp(_settings.ScannerIp, token)
                    ?? throw new IOException("Scanner configuration is missing.");
                _variables = await _database.GetMachineFanucVariableByMachineId(_machine, token)
                    ?? throw new IOException("Machine-variable configuration is missing.");
                if (string.IsNullOrWhiteSpace(_machine.id) || string.IsNullOrWhiteSpace(_scannerDetail.id) || string.IsNullOrWhiteSpace(_variables.id))
                    throw new IOException("API configuration contains a missing record ID.");
                var scannerMachine = _scannerDetail.machine_id ?? _scannerDetail.machine?.id;
                if (!string.Equals(scannerMachine, _machine.id, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The configured scanner is not assigned to this machine in GearApps.");
                await _fanuc.InitializeAsync(token);
                return;
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Unable to initialize Lapper Read; retrying");
                await Task.Delay(_settings.RetryDelayMilliseconds, token);
            }
        }
    }

    private async Task CheckpointAsync(CancellationToken token)
    {
        await _store.SaveAsync(_tracker.State, token);
        _checkpointDirty = false;
    }

    private async Task SampleAsync(CancellationToken token)
    {
        var retryScannerAfter = DateTimeOffset.MinValue;
        while (true)
        {
            token.ThrowIfCancellationRequested();
            try
            {
                ScannerState previous;
                await _stateGate.WaitAsync(token);
                try
                {
                    if (_checkpointDirty) await CheckpointAsync(token);
                    previous = new(_tracker.State.ScannerSerial, _tracker.State.QueuedSerial);
                }
                finally { _stateGate.Release(); }

                var machine = _fanuc.ReadState();
                var scanner = previous;
                if (DateTimeOffset.UtcNow >= retryScannerAfter)
                {
                    try
                    {
                        scanner = await _scanner.ReadAsync(previous, token);
                        retryScannerAfter = DateTimeOffset.MinValue;
                    }
                    catch (Exception exception) when (!token.IsCancellationRequested &&
                        exception is IOException or SocketException or OperationCanceledException)
                    {
                        retryScannerAfter = DateTimeOffset.UtcNow.AddMilliseconds(_settings.RetryDelayMilliseconds);
                        _logger.LogWarning(exception, "Scanner unavailable; preserving its last known serials");
                    }
                }
                await _stateGate.WaitAsync(token);
                try
                {
                    var state = _tracker.State;
                    var before = (state.WasInCycle, state.ScannerSerial, state.QueuedSerial, state.ActiveCycle, state.PendingCycles.Count);
                    _tracker.Observe(machine, scanner, _machine.id, _fanuc.CaptureMacros, DateTimeOffset.UtcNow);
                    if (state.ActiveCycle != before.ActiveCycle && state.ActiveCycle is { Serial: null })
                        _logger.LogWarning("Cycle {Consec} has no confirmed scanned serial; it will not be recorded under a substitute serial", machine.Consec);
                    var after = (state.WasInCycle, state.ScannerSerial, state.QueuedSerial, state.ActiveCycle, state.PendingCycles.Count);
                    if (before != after)
                    {
                        _checkpointDirty = true;
                        await CheckpointAsync(token);
                    }
                    _latestTelemetry = new(machine, state.ActiveCycle?.Serial, state.QueuedSerial, state.ScannerSerial);
                }
                finally { _stateGate.Release(); }
                await Task.Delay(_settings.PollIntervalMilliseconds, token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Machine polling failed; keeping the last confirmed state");
                await Task.Delay(_settings.RetryDelayMilliseconds, token);
            }
        }
    }

    private async Task PublishAsync(CancellationToken token)
    {
        while (true)
        {
            token.ThrowIfCancellationRequested();
            try
            {
                PendingCycle? pending;
                Telemetry? telemetry;
                await _stateGate.WaitAsync(token);
                try
                {
                    if (_checkpointDirty) await CheckpointAsync(token);
                    pending = _tracker.State.PendingCycles.FirstOrDefault();
                    telemetry = _latestTelemetry;
                }
                finally { _stateGate.Release(); }

                if (pending != null)
                {
                    if (pending.SavedCycle == null)
                    {
                        var gearset = await _database.GetGearsetByNumber(pending.PartNumber, token)
                            ?? throw new IOException("Cycle gearset is unavailable.");
                        if (string.IsNullOrWhiteSpace(gearset.id)) throw new IOException("Cycle gearset has no ID.");
                        var saved = await _database.PostMachineCycle(pending.Serial, pending.Consec, pending.MachineId,
                            gearset.id, pending.CompletedAt, pending.Id, token);
                        if (string.IsNullOrWhiteSpace(saved?.id)) throw new IOException("Cycle write was not acknowledged.");
                        await _stateGate.WaitAsync(token);
                        try { pending.SavedCycle = saved; _checkpointDirty = true; await CheckpointAsync(token); }
                        finally { _stateGate.Release(); }
                    }
                    // Values were captured at cycle completion, never re-read on a later API retry.
                    await _fanuc.PersistMacrosAsync(pending.SavedCycle!, pending.Macros, pending.Id, token);
                    await _stateGate.WaitAsync(token);
                    try
                    {
                        _tracker.State.PendingCycles.Remove(pending);
                        _checkpointDirty = true;
                        await CheckpointAsync(token);
                    }
                    finally { _stateGate.Release(); }
                }

                if (telemetry != null && telemetry != _savedTelemetry)
                {
                    var scannerSaved = await _database.PutScannerDetailsSerialNumbers(telemetry.Process,
                        telemetry.Queue, telemetry.Scanner, _scannerDetail, token);
                    if (scannerSaved == null) throw new IOException("Scanner update was not acknowledged.");
                    var variablesSaved = await _database.PatchMachineFanucVariables(telemetry.Machine.DoorClosed,
                        telemetry.Machine.StartCycle, telemetry.Machine.InCycle, _variables, token);
                    if (variablesSaved == null) throw new IOException("Machine-variable update was not acknowledged.");
                    _savedTelemetry = telemetry;
                }
                await Task.Delay(_settings.PollIntervalMilliseconds, token);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception exception)
            {
                _logger.LogError(exception, "API publishing failed; pending records will be retried");
                await Task.Delay(_settings.RetryDelayMilliseconds, token);
            }
        }
    }
}
