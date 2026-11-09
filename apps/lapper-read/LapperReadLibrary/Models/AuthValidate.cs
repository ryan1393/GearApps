namespace LapperReadLibrary.Models;

public record AuthValidate(
    string email,
    string fname,
    string lname,
    string sub,
    int iat,
    int exp
    );