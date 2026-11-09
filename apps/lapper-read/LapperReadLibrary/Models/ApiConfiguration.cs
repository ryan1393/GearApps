namespace LapperReadLibrary.Models;

public class ApiConfiguration
{
    public string BaseAddress { get; set; } = "http://localhost:3333";
    public string Email { get; set; } = "";
    public string Password { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 10;
}

public class ArgonautConfiguration
{
    public string Endpoint { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
}
