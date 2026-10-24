package privacy

// Verhoeff checksum tables (dihedral group D5). Aadhaar numbers carry a Verhoeff check digit,
// so validating it cuts false positives on random 12-digit numbers (SECURITY_ARCHITECTURE §10.1).
var (
	verhoeffD = [10][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
		{1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
		{2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
		{3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
		{4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
		{5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
		{6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
		{7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
		{8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
		{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
	}
	verhoeffP = [8][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
		{1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
		{5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
		{8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
		{9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
		{4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
		{2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
		{7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
	}
	verhoeffInv = [10]int{0, 4, 3, 2, 1, 5, 6, 7, 8, 9}
)

// VerhoeffValid reports whether the ASCII digit string carries a valid Verhoeff check digit.
func VerhoeffValid(digits string) bool {
	if digits == "" {
		return false
	}
	c := 0
	for i := 0; i < len(digits); i++ {
		ch := digits[len(digits)-1-i]
		if ch < '0' || ch > '9' {
			return false
		}
		c = verhoeffD[c][verhoeffP[i%8][int(ch-'0')]]
	}
	return c == 0
}

// VerhoeffCheckDigit returns the check digit to append to the ASCII digit string.
// It exists for tests and synthetic fixtures only; never use it to build a real-looking ID.
func VerhoeffCheckDigit(digits string) byte {
	c := 0
	for i := 0; i < len(digits); i++ {
		ch := digits[len(digits)-1-i]
		c = verhoeffD[c][verhoeffP[(i+1)%8][int(ch-'0')]]
	}
	return byte('0' + verhoeffInv[c])
}
