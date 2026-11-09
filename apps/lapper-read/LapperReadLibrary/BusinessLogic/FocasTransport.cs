using System.Collections.Concurrent;
using LapperReadLibrary.BusinessLogic.Helpers;
using LapperReadLibrary.BusinessLogic.Interfaces;

namespace LapperReadLibrary.BusinessLogic;

/// <summary>Keeps native FANUC handles and calls on one dedicated thread.</summary>
public sealed class FocasTransport : IFanucTransport, IDisposable
{
    private readonly BlockingCollection<Action> _calls = new();
    private readonly Thread _thread;
    private volatile bool _disposed;

    public FocasTransport()
    {
        _thread = new Thread(() =>
        {
            foreach (var call in _calls.GetConsumingEnumerable()) call();
        }) { IsBackground = true, Name = "LapperRead.FOCAS" };
        _thread.Start();
    }

    private T Invoke<T>(Func<T> operation)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(FocasTransport));
        var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            _calls.Add(() =>
            {
                try { completion.SetResult(operation()); }
                catch (Exception exception) { completion.SetException(exception); }
            });
        }
        catch (InvalidOperationException) { throw new ObjectDisposedException(nameof(FocasTransport)); }
        return completion.Task.GetAwaiter().GetResult();
    }

    public ushort Open(string ip, int timeoutSeconds) => Invoke(() =>
    {
        var result = Focas1.cnc_allclibhndl3(ip, 8193, timeoutSeconds, out var handle);
        Check(result, "connect");
        return handle;
    });

    public void Close(ushort handle) => Invoke(() => Focas1.cnc_freelibhndl(handle));

    public decimal? ReadMacro(ushort handle, short number) => Invoke<decimal?>(() =>
    {
        var data = new Focas1.ODBPM();
        var result = Focas1.cnc_rdpmacro(handle, number, data);
        if (result < 0) Check(result, "read macro");
        if (result != Focas1.EW_OK) return null;
        return data.dec_val >= 0
            ? data.mcr_val / (decimal)Math.Pow(10, data.dec_val)
            : data.mcr_val * (decimal)Math.Pow(10, -data.dec_val);
    });

    public bool ReadPmc(ushort handle, short addressType, short dataType, ushort start, ushort end, int bit) => Invoke(() =>
    {
        var data = new Focas1.IODBPMC0();
        var length = checked((ushort)(8 + end - start + 1));
        Check(Focas1.pmc_rdpmcrng(handle, addressType, dataType, start, end, length, data), "read PMC");
        return data.cdata[0].GetBit(bit);
    });

    private static void Check(short code, string operation)
    {
        if (code != Focas1.EW_OK) throw new IOException($"FANUC {operation} failed (code {code}).");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _calls.CompleteAdding();
        _thread.Join();
        _calls.Dispose();
    }
}
