using LapperReadLibrary.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace LapperRead.Tests;

public class ConfigurationTests
{
    [Fact]
    public void IpArgumentOverridesMachineButRetainsScannerAndOtherSettings()
    {
        using var area = new TestArea();
        using var host = global::LapperRead.Program.CreateHostBuilder(["ip=127.0.0.2"])
            .ConfigureAppConfiguration((_, builder) => builder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["LapperConfiguration:MachineIp"] = "127.0.0.1", ["LapperConfiguration:ScannerIp"] = "127.0.0.3",
                ["LapperConfiguration:StateDirectory"] = area.DirectoryPath, ["LapperConfiguration:IoTimeoutMilliseconds"] = "250",
                ["MeshForgeApi:Email"] = "test@example.invalid", ["MeshForgeApi:Password"] = "test"
            })).Build();
        var settings = host.Services.GetRequiredService<IOptions<LapperConfiguration>>().Value;
        Assert.Equal("127.0.0.2", settings.MachineIp); Assert.Equal("127.0.0.3", settings.ScannerIp); Assert.Equal(250, settings.IoTimeoutMilliseconds);
    }

    [Fact]
    public void MissingCredentialsFailConfigurationValidation()
    {
        using var area = new TestArea();
        using var host = global::LapperRead.Program.CreateHostBuilder([])
            .ConfigureAppConfiguration((_, builder) => builder.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["LapperConfiguration:MachineIp"] = "127.0.0.1", ["LapperConfiguration:ScannerIp"] = "127.0.0.3",
                ["LapperConfiguration:StateDirectory"] = area.DirectoryPath, ["MeshForgeApi:Email"] = "", ["MeshForgeApi:Password"] = ""
            })).Build();
        Assert.Throws<OptionsValidationException>(() => host.Services.GetRequiredService<IOptions<ApiConfiguration>>().Value);
    }
}
