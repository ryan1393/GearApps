using System.Net;
using System.Net.Sockets;
using System.Text;
using LapperReadLibrary.Models;
using Microsoft.Extensions.Options;
using Scanner = LapperReadLibrary.BusinessLogic.Scanner;

namespace LapperRead.Tests;

public class ScannerTests
{
    private static Scanner Client(int port, int timeout = 2000) => new(Options.Create(new LapperConfiguration
    { ScannerIp = "127.0.0.1", ScannerInput1Port = port, ScannerInput2Port = port, IoTimeoutMilliseconds = timeout }));

    private static async Task<string> Command(NetworkStream stream, CancellationToken token)
    {
        var command = new StringBuilder(); var buffer = new byte[1];
        while (await stream.ReadAsync(buffer, token) != 0)
        { if (buffer[0] == '\r') return command.ToString(); command.Append((char)buffer[0]); }
        throw new IOException("Connection closed before command terminator.");
    }

    [Fact]
    public async Task FragmentedAndCoalescedFramesProduceACompleteSerial()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var scanner = Client(((IPEndPoint)listener.LocalEndpoint).Port);
        var server = Task.Run(async () =>
        {
            using var socket = await listener.AcceptTcpClientAsync(deadline.Token); var stream = socket.GetStream();
            Assert.Equal("INCHK,1", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,INCHK,ON\r"), deadline.Token);
            Assert.Equal("AMON", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,AMON\r"), deadline.Token);
            Assert.Equal("LON01", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,LON01\r\nD1234"), deadline.Token);
            await Task.Delay(20, deadline.Token); await stream.WriteAsync(Encoding.ASCII.GetBytes("56789:metadata\r\n"), deadline.Token);
        });
        var state = await scanner.ReadAsync(new(null, null), deadline.Token);
        Assert.Equal("D123456789", state.Serial); await server;
    }

    [Fact]
    public async Task TimeoutDisposesConnectionAndNextPollReconnects()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var scanner = Client(((IPEndPoint)listener.LocalEndpoint).Port, 150);
        var first = scanner.ReadAsync(new(null, null), deadline.Token); using var silent = await listener.AcceptTcpClientAsync(deadline.Token);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        var second = scanner.ReadAsync(new(null, null), deadline.Token); using var recovered = await listener.AcceptTcpClientAsync(deadline.Token);
        var stream = recovered.GetStream(); Assert.Equal("INCHK,1", await Command(stream, deadline.Token));
        await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,INCHK,OFF\r"), deadline.Token);
        Assert.Equal("AMON", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,AMON\r"), deadline.Token);
        Assert.Equal(new ScannerState(null, null), await second);
    }

    [Fact]
    public async Task CancellationInterruptsAReceive()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var scanner = Client(((IPEndPoint)listener.LocalEndpoint).Port);
        using var stop = new CancellationTokenSource(); var read = scanner.ReadAsync(new(null, null), stop.Token);
        using var server = await listener.AcceptTcpClientAsync(); stop.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => read);
    }

    [Fact]
    public async Task SecondInputReconnectsToItsOwnPortAndReturnsTheRecoveredResult()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        using var scanner = Client(((IPEndPoint)listener.LocalEndpoint).Port);
        var first = scanner.Input2Async("INCHK,2", deadline.Token);
        using (var connection = await listener.AcceptTcpClientAsync(deadline.Token)) connection.Close();
        await Assert.ThrowsAnyAsync<Exception>(() => first);
        var retry = scanner.Input2Async("INCHK,2", deadline.Token);
        using var recovered = await listener.AcceptTcpClientAsync(deadline.Token); var stream = recovered.GetStream();
        Assert.Equal("INCHK,2", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,INCHK,ON\r"), deadline.Token);
        Assert.Equal("OUTON,3", await Command(stream, deadline.Token)); await stream.WriteAsync(Encoding.ASCII.GetBytes("OK,OUTON,3\r"), deadline.Token);
        Assert.Equal("ON", await retry);
    }
}
