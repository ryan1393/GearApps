using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using LapperReadLibrary.BusinessLogic.Interfaces;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Options;

namespace LapperReadLibrary.BusinessLogic;

public sealed class Scanner : IScanners
{
    private readonly LapperConfiguration _settings;
    private readonly Channel _input1;
    private readonly Channel _input2;
    // Serial format in the existing scanner protocol: D followed by nine characters.
    private static readonly Regex SerialPattern = new(@"(?<![A-Za-z0-9])D[A-Za-z0-9]{9}(?=[:\r\n]|$)", RegexOptions.Compiled);

    public Scanner(IOptions<LapperConfiguration> settings)
    {
        _settings = settings.Value;
        var address = IPAddress.Parse(_settings.ScannerIp);
        _input1 = new Channel(new IPEndPoint(address, _settings.ScannerInput1Port));
        _input2 = new Channel(new IPEndPoint(address, _settings.ScannerInput2Port));
    }

    public async Task<ScannerState> ReadAsync(ScannerState previous, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_settings.IoTimeoutMilliseconds);
        var response = await _input1.ExchangeAsync("INCHK,1", timeout.Token);
        if (response.Contains("OK,INCHK,OFF", StringComparison.Ordinal))
        {
            if (previous.Serial != null && previous.Queue == null) return new(null, previous.Serial);
            await _input1.ExchangeAsync("AMON", timeout.Token);
            return previous;
        }
        if (response.Contains("OK,INCHK,ON", StringComparison.Ordinal))
        {
            if (previous.Serial != null)
            {
                await _input1.ExchangeAsync("AMOFF", timeout.Token);
                return previous;
            }
            await _input1.ExchangeAsync("AMON", timeout.Token);
            response = await _input1.ExchangeAsync("LON01", timeout.Token, waitForSerial: true);
        }
        var match = SerialPattern.Match(response);
        if (!match.Success) throw new IOException("The scanner response did not contain a complete serial or input state.");
        return new ScannerState(match.Value, previous.Queue == match.Value ? null : previous.Queue);
    }

    public async Task<string> Input2Async(string command, CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_settings.IoTimeoutMilliseconds);
        var response = await _input2.ExchangeAsync(command, timeout.Token);
        if (!command.Contains("INCHK,2", StringComparison.Ordinal)) return response;
        var on = response.Contains("OK,INCHK,ON", StringComparison.Ordinal);
        if (!on && !response.Contains("OK,INCHK,OFF", StringComparison.Ordinal))
            throw new IOException("The second scanner input state is unavailable.");
        await _input2.ExchangeAsync(on ? "OUTON,3" : "OUTOFF,3", timeout.Token);
        return on ? "ON" : "OFF";
    }

    public void Dispose() { _input1.Dispose(); _input2.Dispose(); }

    private sealed class Channel(IPEndPoint endpoint) : IDisposable
    {
        private Socket? _socket;
        private readonly StringBuilder _received = new();

        public async Task<string> ExchangeAsync(string command, CancellationToken token, bool waitForSerial = false)
        {
            try
            {
                if (_socket == null)
                {
                    _socket = new Socket(endpoint.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                    await _socket.ConnectAsync(endpoint, token);
                }
                var bytes = Encoding.ASCII.GetBytes(command.TrimEnd('\r', '\n') + "\r");
                for (var sent = 0; sent < bytes.Length;)
                {
                    var count = await _socket.SendAsync(bytes.AsMemory(sent), SocketFlags.None, token);
                    if (count == 0) throw new IOException("Scanner disconnected during a command.");
                    sent += count;
                }
                while (true)
                {
                    var accumulated = _received.ToString();
                    var delimiter = accumulated.IndexOfAny(['\r', '\n']);
                    if (delimiter >= 0)
                    {
                        var frame = accumulated[..delimiter];
                        var consumed = delimiter + 1;
                        // Consume CRLF as one delimiter while retaining any coalesced next frame.
                        if (consumed < accumulated.Length && accumulated[delimiter] == '\r' && accumulated[consumed] == '\n') consumed++;
                        _received.Remove(0, consumed);
                        if (frame.Length == 0) continue;
                        if (!waitForSerial || SerialPattern.IsMatch(frame)) return frame;
                        if (frame.StartsWith("ER", StringComparison.Ordinal)) throw new IOException("Scanner rejected the scan command.");
                        continue; // LON acknowledgements may precede the actual barcode frame.
                    }
                    if (_received.Length > 8192) throw new IOException("Scanner response exceeded the maximum frame length.");
                    var buffer = new byte[512];
                    var received = await _socket.ReceiveAsync(buffer, SocketFlags.None, token);
                    if (received == 0) throw new IOException("Scanner disconnected while receiving a response.");
                    _received.Append(Encoding.ASCII.GetString(buffer, 0, received));
                }
            }
            catch { Dispose(); throw; }
        }

        public void Dispose()
        {
            _socket?.Dispose(); _socket = null; _received.Clear();
        }
    }
}
