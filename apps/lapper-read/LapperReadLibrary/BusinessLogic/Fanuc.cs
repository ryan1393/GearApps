using System.Globalization;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LapperReadLibrary.BusinessLogic;

public sealed class Fanuc : IFanuc
{
    private readonly ILogger<Fanuc> _logger;
    private readonly LapperConfiguration _settings;
    private readonly IDatabaseCalls _database;
    private readonly IFanucTransport _transport;
    private readonly object _connectionGate = new();
    private readonly Dictionary<(string Machine, string Gearset), Dictionary<string, decimal>> _baselines = new();
    private Macro[] _macros = [];
    private ushort? _handle;

    public Fanuc(ILogger<Fanuc> logger, IOptions<LapperConfiguration> settings, IDatabaseCalls database, IFanucTransport transport)
    {
        _logger = logger; _settings = settings.Value; _database = database; _transport = transport;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        _macros = await _database.GetMacroList(cancellationToken)
            ?? throw new IOException("The API did not return a macro list.");
    }

    private T Read<T>(Func<ushort, T> operation)
    {
        lock (_connectionGate)
        {
            try
            {
                _handle ??= _transport.Open(_settings.MachineIp, Math.Max(1, (int)Math.Ceiling(_settings.IoTimeoutMilliseconds / 1000d)));
                return operation(_handle.Value);
            }
            catch
            {
                Dispose();
                throw;
            }
        }
    }

    public string? GetMacroValue(short number) => Read(handle => _transport.ReadMacro(handle, number))?.ToString(CultureInfo.InvariantCulture);

    public MachineState ReadState()
    {
        var identText = GetMacroValue(10020);
        var consecText = GetMacroValue(10032);
        if (!TryCounter(identText, out var ident) || !TryCounter(consecText, out var consec))
            throw new IOException("FANUC ident or consecutive count is unavailable.");
        return new MachineState(ident, consec,
            Read(handle => _transport.ReadPmc(handle, 3, 0, 6, 6, 7)),
            Read(handle => _transport.ReadPmc(handle, 3, 0, 1, 1, 2)),
            Read(handle => _transport.ReadPmc(handle, 2, 0, 3, 3, 2)));
    }

    private static bool TryCounter(string? text, out int counter)
    {
        counter = 0;
        if (!decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ||
            value <= 0 || value > int.MaxValue || decimal.Truncate(value) != value) return false;
        counter = (int)value;
        return true;
    }

    public Dictionary<string, decimal> CaptureMacros()
    {
        var values = new Dictionary<string, decimal>();
        foreach (var macro in _macros)
        {
            var text = GetMacroValue(macro.number);
            if (decimal.TryParse(text, NumberStyles.Number, CultureInfo.InvariantCulture, out var value))
                values[macro.id] = value;
            else
                _logger.LogWarning("Macro {MacroNumber} is unavailable; its previous baseline is retained", macro.number);
        }
        return values;
    }

    public async Task PersistMacrosAsync(MachineCycle cycle, IReadOnlyDictionary<string, decimal> values,
        string requestId, CancellationToken cancellationToken = default)
    {
        var key = (cycle.machine.id, cycle.gearset.id);
        if (!_baselines.TryGetValue(key, out var baseline))
        {
            var previous = await _database.GetLappingSummary(new LastLogData(key.Item1, key.Item2), cancellationToken)
                ?? throw new IOException("The API did not return the previous macro summary.");
            baseline = previous.GroupBy(log => log.macro_id).ToDictionary(group => group.Key, group => group.Last().value);
            _baselines[key] = baseline;
        }
        foreach (var (id, value) in values)
        {
            if (baseline.TryGetValue(id, out var old) && old == value) continue;
            var saved = await _database.PostMacroLog(cycle, id, value, requestId + ":" + id, cancellationToken);
            if (string.IsNullOrWhiteSpace(saved?.id)) throw new IOException("The API did not acknowledge a macro write.");
            // Only acknowledged values advance. Missing reads do not remove baseline keys.
            baseline[id] = value;
        }
    }

    public void Dispose()
    {
        lock (_connectionGate)
        {
            if (_handle is not { } handle) return;
            _handle = null;
            try { _transport.Close(handle); }
            catch (Exception exception) { _logger.LogWarning(exception, "Unable to release the FANUC connection"); }
        }
    }
}
