using System.Text.Json;
using LapperReadLibrary.Models;

namespace LapperReadLibrary.BusinessLogic;

/// <summary>Checkpoints active and completed cycles before acknowledging state changes.</summary>
public sealed class CycleStateStore(string path)
{
    private readonly string _path = Path.GetFullPath(path);

    public IDisposable AcquireLease()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        return new FileStream(_path + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }

    public async Task<CycleState> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_path)) return new CycleState();
        using var stream = File.OpenRead(_path);
        // Corrupt checkpoints must never silently discard pending production records.
        var state = await JsonSerializer.DeserializeAsync<CycleState>(stream, cancellationToken: cancellationToken)
            ?? throw new InvalidDataException("The cycle checkpoint is empty.");
        if (state.PendingCycles == null || state.PendingCycles.Any(cycle => cycle == null ||
            string.IsNullOrWhiteSpace(cycle.Id) || string.IsNullOrWhiteSpace(cycle.Serial) || cycle.Macros == null))
            throw new InvalidDataException("The cycle checkpoint contains invalid pending records.");
        return state;
    }

    public async Task SaveAsync(CycleState state, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temporary = _path + ".tmp";
        await using (var stream = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
        {
            await JsonSerializer.SerializeAsync(stream, state, cancellationToken: cancellationToken);
            await stream.FlushAsync(cancellationToken);
            stream.Flush(flushToDisk: true);
        }
        File.Move(temporary, _path, overwrite: true);
    }
}
